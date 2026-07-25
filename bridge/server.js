'use strict'

const express = require('express')
const { RobotManager } = require('./lib/robotManager')

const app = express()
const port = Number(process.env.PORT || 8080)
const mgr = new RobotManager()

app.use(express.json({ limit: '256kb' }))

app.get('/health', (_req, res) => {
  const s = mgr.getState()
  res.json({
    ok: true,
    connected: s.connected,
    conflict: s.conflict,
    version: s.bridge.version,
    uptime_s: s.bridge.uptime_s,
    mock: process.env.ROOMBA_MOCK === '1',
  })
})

app.get('/state', (_req, res) => {
  res.json(mgr.getState())
})

app.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()
  const send = (s) => {
    res.write(`event: state\ndata: ${JSON.stringify(s)}\n\n`)
  }
  send(mgr.getState())
  const off = mgr.onUpdate(send)
  const iv = setInterval(() => res.write(': ping\n\n'), 15000)
  req.on('close', () => {
    clearInterval(iv)
    off()
  })
})

app.post('/action/:name', async (req, res) => {
  try {
    const out = await mgr.action(req.params.name)
    res.json(out)
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) })
  }
})

app.post('/connect', async (req, res) => {
  const { blid, password, ip } = req.body || {}
  if (!blid || !password || !ip) {
    return res.status(400).json({ error: 'blid, password, ip required' })
  }
  const out = await mgr.connect(blid, password, ip)
  res.status(out.ok ? 200 : 502).json(out)
})

app.post('/discover', async (_req, res) => {
  res.json(await mgr.discover())
})

app.post('/onboard/get-password', async (req, res) => {
  const ip = req.body?.ip
  if (!ip) return res.status(400).json({ error: 'ip required' })
  const out = await mgr.getPassword(ip)
  res.status(out.error ? 502 : 200).json(out)
})

app.get('/schedule', async (_req, res) => {
  try {
    res.json(await mgr.getSchedule())
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) })
  }
})

app.post('/schedule', async (req, res) => {
  try {
    res.json(await mgr.setSchedule(req.body || {}))
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) })
  }
})

app.get('/preferences', async (_req, res) => {
  try {
    res.json(await mgr.getPreferences())
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) })
  }
})

app.post('/preferences', async (req, res) => {
  try {
    res.json(await mgr.setPreferences(req.body || {}))
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) })
  }
})

app.get('/bbrun', async (_req, res) => {
  try {
    res.json(await mgr.getBbrun())
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) })
  }
})

app.listen(port, '0.0.0.0', () => {
  console.log(`nc-roomba-bridge listening on ${port} mock=${process.env.ROOMBA_MOCK === '1'}`)
})
