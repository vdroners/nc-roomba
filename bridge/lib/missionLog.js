'use strict'

/**
 * Persisted journal of completed missions.
 *
 * Why this exists
 * ---------------
 * The bridge holds the only second-by-second view of a mission: it sees every
 * MQTT state push, so it knows exactly when a cycle started and stopped, and it
 * is the thing that accumulates the pose trail and the covered-cell footprint.
 *
 * Nextcloud, by contrast, samples the bridge from a cron job. Nextcloud cron
 * runs every five minutes and rotates jobs, so measured sample gaps on this
 * install are a median of 15 minutes and a maximum of 110 — against an average
 * mission length of 28 minutes. Reconstructing missions from those samples
 * alone means missing short runs entirely and mis-dating the rest by up to a
 * quarter of an hour.
 *
 * So the bridge records each completed mission here, and Nextcloud drains the
 * journal on its own schedule. Nextcloud can be slow, restart, or be down for a
 * day without losing a mission — it just picks up from the last id it saw.
 *
 * The journal is written to disk because an in-memory buffer would be emptied
 * by a `docker compose up --build`, which is exactly when history is most
 * likely to be lost. Writes are atomic (tmp + rename) so a crash mid-write
 * cannot leave a truncated file that fails to parse on boot.
 */

const fs = require('fs')
const path = require('path')

/** Keep the journal bounded; Nextcloud is the long-term store. */
const DEFAULT_MAX = 200

class MissionLog {
	/**
	 * @param {object} [opts]
	 * @param {string} [opts.path] journal file path
	 * @param {number} [opts.max] ring-buffer cap
	 * @param {Console} [opts.logger]
	 */
	constructor(opts = {}) {
		this.path = opts.path || process.env.ROOMBA_MISSION_LOG || '/data/missions.json'
		this.max = Number(opts.max || process.env.ROOMBA_MISSION_LOG_MAX || DEFAULT_MAX)
		this.logger = opts.logger || console
		/** @type {object[]} */
		this.records = []
		/** Monotonic within a journal; Nextcloud drains with `?since=<seq>`. */
		this.nextSeq = 1
		this.load()
	}

	/** Read the journal from disk. A missing or corrupt file is not fatal. */
	load() {
		try {
			const raw = fs.readFileSync(this.path, 'utf8')
			const parsed = JSON.parse(raw)
			if (Array.isArray(parsed?.records)) {
				this.records = parsed.records
				this.nextSeq = Number(parsed.next_seq) || this.#deriveNextSeq()
			}
		} catch (err) {
			if (err && err.code !== 'ENOENT') {
				// A corrupt journal must not stop the bridge from booting — the
				// robot still needs controlling. Start fresh and say so.
				this.logger.warn(`missionLog: could not read ${this.path} (${err.message}); starting empty`)
			}
			this.records = []
			this.nextSeq = 1
		}
	}

	#deriveNextSeq() {
		return this.records.reduce((max, r) => Math.max(max, Number(r.seq) || 0), 0) + 1
	}

	/**
	 * Record a completed mission.
	 *
	 * @param {object} record mission fields (seq/recorded_at are added here)
	 * @returns {object} the stored record
	 */
	append(record) {
		const stored = {
			seq: this.nextSeq++,
			recorded_at: new Date().toISOString(),
			...record,
		}
		this.records.push(stored)
		if (this.records.length > this.max) {
			this.records.splice(0, this.records.length - this.max)
		}
		this.persist()
		return stored
	}

	/**
	 * @param {number} since exclusive lower bound on `seq` (0 = everything held)
	 * @param {number} [limit]
	 * @returns {object[]} records newer than `since`, oldest first
	 */
	since(since = 0, limit = 100) {
		const from = Number(since) || 0
		return this.records
			.filter((r) => Number(r.seq) > from)
			.slice(0, Math.max(1, Math.min(500, Number(limit) || 100)))
	}

	/** @returns {{next_seq:number,count:number,oldest_seq:?number,newest_seq:?number}} */
	summary() {
		return {
			next_seq: this.nextSeq,
			count: this.records.length,
			oldest_seq: this.records.length ? Number(this.records[0].seq) : null,
			newest_seq: this.records.length ? Number(this.records[this.records.length - 1].seq) : null,
		}
	}

	/** Atomic write: tmp + rename, so a crash cannot truncate the journal. */
	persist() {
		const payload = JSON.stringify({
			version: 1,
			next_seq: this.nextSeq,
			records: this.records,
		})
		const tmp = `${this.path}.tmp`
		try {
			fs.mkdirSync(path.dirname(this.path), { recursive: true })
			fs.writeFileSync(tmp, payload, 'utf8')
			fs.renameSync(tmp, this.path)
		} catch (err) {
			// Losing the journal is bad but must never take the robot offline.
			this.logger.warn(`missionLog: could not write ${this.path} (${err.message})`)
			try {
				fs.unlinkSync(tmp)
			} catch {
				// nothing to clean up
			}
		}
	}
}

module.exports = { MissionLog, DEFAULT_MAX }
