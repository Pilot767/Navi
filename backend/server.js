import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import multer from 'multer'
import { SpeechClient } from '@google-cloud/speech'
import { WebSocketServer } from 'ws'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.join(__dirname, '.env') })

const app = express()
app.use(cors())
app.use(express.json({ limit: '2mb' }))

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } })
const speechClient = new SpeechClient()

function loadCatalog() {
  try {
    const p = path.join(__dirname, 'knowledge', 'product_catalog.json')
    const raw = fs.readFileSync(p, 'utf8')
    const j = JSON.parse(raw)
    const items = Array.isArray(j?.items) ? j.items : []
    return { version: String(j?.version ?? 'unknown'), items }
  } catch {
    return { version: 'missing', items: [] }
  }
}

const CATALOG = loadCatalog()

function loadSnippets() {
  try {
    const p = path.join(__dirname, 'knowledge', 'sqb_site_snippets.json')
    const raw = fs.readFileSync(p, 'utf8')
    const j = JSON.parse(raw)
    const snippets = Array.isArray(j?.snippets) ? j.snippets : []
    return { version: String(j?.version ?? 'unknown'), snippets }
  } catch {
    return { version: 'missing', snippets: [] }
  }
}

const SQB_SNIPPETS = loadSnippets()

function loadRules() {
  try {
    const p = path.join(__dirname, 'knowledge', 'sqb-copilot-knowledge-base-v2.json')
    const raw = fs.readFileSync(p, 'utf8')
    const j = JSON.parse(raw)
    // Accept both formats:
    // - { rules: [...] } (simple)
    // - { qa: [{ tags, variants_uz, variants_ru, answer_uz, answer_ru, ... }] } (knowledge-base v2)
    const directRules = Array.isArray(j?.rules) ? j.rules : []
    const qa = Array.isArray(j?.qa) ? j.qa : []
    const qaRules = qa
      .map((x) => {
        const tags = (Array.isArray(x?.tags) ? x.tags : []).map(String).filter(Boolean)
        const match = [
          ...((Array.isArray(x?.variants_uz) ? x.variants_uz : []).map(String)),
          ...((Array.isArray(x?.variants_ru) ? x.variants_ru : []).map(String)),
        ].filter(Boolean)
        const reply_uz = typeof x?.answer_uz === 'string' ? x.answer_uz : ''
        const reply_ru = typeof x?.answer_ru === 'string' ? x.answer_ru : ''
        if (!match.length || (!reply_uz && !reply_ru)) return null
        return {
          id: String(x?.id ?? ''),
          tags,
          match,
          reply_uz,
          reply_ru,
          source: typeof x?.source === 'string' ? x.source : '',
        }
      })
      .filter(Boolean)
    const rules = directRules.length ? directRules : qaRules
    return { version: String(j?._meta?.version ?? j?.version ?? 'unknown'), rules }
  } catch {
    return { version: 'missing', rules: [] }
  }
}

const FAQ_RULES = loadRules()

function loadConversationRules() {
  try {
    const p = path.join(__dirname, 'knowledge', 'conversation_rules.json')
    const raw = fs.readFileSync(p, 'utf8')
    const j = JSON.parse(raw)
    const entries = Array.isArray(j?.entries) ? j.entries : []
    return { version: String(j?.version ?? 'unknown'), entries }
  } catch {
    return { version: 'missing', entries: [] }
  }
}

const CONVERSATION_RULES = loadConversationRules()

function loadTopicPlaybooks() {
  try {
    const p = path.join(__dirname, 'knowledge', 'topic_playbooks.json')
    const raw = fs.readFileSync(p, 'utf8')
    const j = JSON.parse(raw)
    return { version: String(j?.version ?? 'unknown'), playbooks: Array.isArray(j?.playbooks) ? j.playbooks : [] }
  } catch {
    return { version: 'missing', playbooks: [] }
  }
}

const TOPIC_PLAYBOOKS = loadTopicPlaybooks()

const SYNTH = (() => {
  try {
    const p = path.join(__dirname, 'knowledge', 'synthetic_customers.json')
    const raw = fs.readFileSync(p, 'utf8')
    const j = JSON.parse(raw)
    const arr = Array.isArray(j?.customers) ? j.customers : []
    const byId = new Map(arr.map((c) => [String(c?.customer_id ?? ''), c]))
    return { version: String(j?.version ?? 'unknown'), byId }
  } catch {
    return { version: 'missing', byId: new Map() }
  }
})()

function getCustomerContext(profile) {
  const id = String(profile?.id ?? '')
  const syn = id ? SYNTH.byId.get(id) : null
  if (!syn) return { customer_id: id || null, synthetic: false, context: null }
  return {
    customer_id: id,
    synthetic: true,
    context: {
      segment: syn.segment,
      risk_band: syn.risk_band,
      score: syn.score,
      monthly_income_uzs: syn.monthly_income_uzs,
      salary_card: syn.salary_card,
      active_loans: syn.active_loans,
      dpd30_last_12m: syn.dpd30_last_12m,
      avg_monthly_turnover_uzs: syn.avg_monthly_turnover_uzs,
      signals: syn.signals ?? [],
    },
  }
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: ac.signal })
  } finally {
    clearTimeout(t)
  }
}

function detectIntent(utterance = '') {
  const u = String(utterance).toLowerCase()
  if (/komissiya|commission|fee|tarif|service fee|xizmat haqi|комисси|тариф/i.test(u)) return 'fees'
  if (/o‘tkazma|o'tkazma|transfer|swift|перевод|международ/i.test(u)) return 'transfers'
  if (/karta|uzcard|humo|visa|mastercard|карт/i.test(u)) return 'cards'
  if (/depozit|omonat|вклад|депозит/i.test(u)) return 'deposits'
  if (/kredit|loan|qarz|ипотек|автокредит|кредит/i.test(u)) return 'credits'
  return 'general'
}

function normalizeText(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(s) {
  return normalizeText(s)
    .split(' ')
    .filter((t) => t.length >= 3)
}

function topicHints(topic) {
  const t = normalizeText(topic ?? '')
  if (!t) return []
  if (/(karta|cards|card|карта)/i.test(t)) return ['karta', 'cards', 'card', 'карта', 'visa', 'mastercard', 'uzcard', 'humo']
  if (/(otkaz|o tkaz|transfer|swift|перевод|перевести)/i.test(t)) return ['otkaz', 'o‘tkaz', 'transfer', 'swift', 'перевод', 'валюта']
  if (/(kredit|loan|qarz|ипотек|credit)/i.test(t)) return ['kredit', 'loan', 'qarz', 'ипотека', 'кредит']
  if (/(depozit|omonat|deposit|депозит)/i.test(t)) return ['depozit', 'omonat', 'deposit', 'депозит']
  if (/(valyuta|currency|обмен|конвертац)/i.test(t)) return ['valyuta', 'currency', 'обмен', 'конвертация']
  return t.split(' ').filter(Boolean).slice(0, 6)
}

/** Mavzu bo‘yicha kutiladigan savol burchaklari (bir chatda 2–3 xil savol) */
function resolveTopicPlaybook(topic) {
  const t = normalizeText(topic ?? '')
  if (!t) return null
  for (const pb of TOPIC_PLAYBOOKS.playbooks) {
    const topics = Array.isArray(pb?.match_topics) ? pb.match_topics : []
    for (const m of topics) {
      const mm = normalizeText(m)
      if (!mm) continue
      if (t.includes(mm) || mm.includes(t)) return pb
    }
  }
  return null
}

function ruleMatchesTopic(rule, topic) {
  const hints = topicHints(topic)
  if (!hints.length) return true
  const tags = Array.isArray(rule?.tags) ? rule.tags.map(String) : []
  if (!tags.length) return true // if rule has no tags, don't block it
  const tset = new Set(tags.map((x) => normalizeText(x)).filter(Boolean))
  for (const h of hints) {
    const hh = normalizeText(h)
    if (!hh) continue
    for (const tt of tset) {
      if (tt === hh) return true
      if (tt.includes(hh) || hh.includes(tt)) return true
    }
  }
  return false
}

function scoreRule(uNorm, uTokens, r) {
  const arr = Array.isArray(r?.match) ? r.match : []
  let bestPhrase = 0
  let tokHits = 0
  for (const m of arr) {
    const mm = normalizeText(m)
    if (!mm) continue
    if (uNorm.includes(mm)) bestPhrase = Math.max(bestPhrase, Math.min(8, Math.ceil(mm.length / 6)))
    const mt = new Set(tokens(mm))
    let hit = 0
    for (const t of uTokens) if (mt.has(t)) hit += 1
    tokHits = Math.max(tokHits, hit)
  }
  return bestPhrase * 3 + tokHits
}

function matchRule(utterance = '', topic = '') {
  const uNorm = normalizeText(utterance)
  if (!uNorm) return null
  const uTokens = tokens(uNorm)
  let best = null
  let bestScore = 0
  for (const r of FAQ_RULES.rules) {
    if (topic && !ruleMatchesTopic(r, topic)) continue
    const s = scoreRule(uNorm, uTokens, r)
    if (s > bestScore) {
      bestScore = s
      best = r
    }
  }
  // threshold avoids random wrong matches
  return bestScore >= 4 ? best : null
}

/** Faqat berilgan conversationId (UI Chat ID) uchun: shu chatga tegishli maxsus javob */
function matchConversationRule(utterance = '', conversationId = '') {
  const cid = String(conversationId ?? '').trim()
  if (!cid) return null
  const uNorm = normalizeText(utterance)
  if (!uNorm) return null
  const uTokens = tokens(uNorm)
  let best = null
  let bestScore = 0
  for (const e of CONVERSATION_RULES.entries) {
    if (String(e?.conversation_id ?? '').trim() !== cid) continue
    const match = Array.isArray(e?.match) ? e.match.map(String).filter(Boolean) : []
    if (!match.length) continue
    const s = scoreRule(uNorm, uTokens, { match })
    if (s > bestScore) {
      bestScore = s
      best = e
    }
  }
  return bestScore >= 4 ? best : null
}

function retrieveSnippets(utterance, topic) {
  const q = `${utterance ?? ''} ${topic ?? ''}`.toLowerCase()
  const scored = []
  for (const s of SQB_SNIPPETS.snippets) {
    const tags = Array.isArray(s?.tags) ? s.tags : []
    let score = 0
    for (const t of tags) {
      const tt = String(t).toLowerCase()
      if (tt && q.includes(tt)) score += tt.length >= 5 ? 2 : 1
    }
    if (score > 0) scored.push({ s, score })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, 3).map((x) => x.s)
}

function retrieveGrounding(utterance, topic) {
  const q = `${utterance ?? ''} ${topic ?? ''}`.toLowerCase()
  const scored = []
  for (const it of CATALOG.items) {
    const kws = Array.isArray(it?.keywords) ? it.keywords : []
    let s = 0
    for (const k of kws) {
      const kk = String(k).toLowerCase()
      if (!kk) continue
      if (q.includes(kk)) s += kk.length >= 5 ? 3 : 1
    }
    if (s > 0) scored.push({ it, s })
  }
  scored.sort((a, b) => b.s - a.s)
  const top = scored.slice(0, 3).map((x) => x.it)
  const grounds = top.flatMap((it) =>
    (Array.isArray(it?.facts) ? it.facts : []).map((f) => `${it.name}: ${String(f)}`),
  )
  return { items: top, grounds: grounds.slice(0, 10) }
}

// --- SQB.UZ knowledge cache (fetch once; use for fast replies) ---
const SQB_URLS = [
  'https://sqb.uz/uz/individuals/credits/',
  'https://sqb.uz/uz/individuals/bank-cards/',
  'https://sqb.uz/uz/individuals/payments/',
  'https://sqb.uz/uz/individuals/deposits/',
  'https://sqb.uz/uz/individuals/ipoteka/',
]

const kb = {
  refreshedAt: 0,
  inFlight: false,
  pages: [],
  lastError: '',
}

function stripHtmlToText(html) {
  const noScript = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  const text = noScript
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  return text
}

function extractTitle(html) {
  const m = String(html).match(/<title>([^<]+)<\/title>/i)
  return (m?.[1] ?? '').trim()
}

async function refreshKb() {
  if (kb.inFlight) return
  kb.inFlight = true
  kb.lastError = ''
  try {
    const pages = []
    for (const url of SQB_URLS) {
      const r = await fetchWithTimeout(url, { method: 'GET' }, 2000)
      if (!r.ok) throw new Error(`KB fetch failed ${url}: ${r.status}`)
      const html = await r.text()
      const title = extractTitle(html) || url
      const text = stripHtmlToText(html).slice(0, 12000)
      pages.push({ url, title, text })
    }
    kb.pages = pages
    kb.refreshedAt = Date.now()
  } catch (e) {
    kb.lastError = String(e)
  } finally {
    kb.inFlight = false
  }
}

function retrieveFromKb(utterance, topic) {
  const q = `${utterance ?? ''} ${topic ?? ''}`.toLowerCase()
  if (!kb.pages.length) return []
  const keys = q.split(/\s+/).filter(Boolean).slice(0, 12)
  const scored = kb.pages
    .map((p) => {
      let s = 0
      const t = p.text.toLowerCase()
      for (const k of keys) if (k.length >= 4 && t.includes(k)) s += 1
      return { p, s }
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 2)
    .map((x) => x.p)
  return scored
}

// --- AI reply endpoint (optional, uses OPENAI_API_KEY if present) ---
app.post('/ai/reply', async (req, res) => {
  try {
    const { utterance, topic, profile, checklist, conversationId } = req.body ?? {}
    const u = typeof utterance === 'string' ? utterance.trim() : ''
    if (!u) return res.status(400).json({ ok: false, error: 'Missing utterance' })

    const intent = detectIntent(u)
    const playbook = resolveTopicPlaybook(topic)
    const grounding = retrieveGrounding(u, topic)
    const snippets = retrieveSnippets(u, topic)
    const kbPages = retrieveFromKb(u, topic)
    const cust = getCustomerContext(profile)
    const isRu = /[\u0400-\u04FF]/.test(u)

    // 0) Chat-ID ga bog‘liq maxsus qoidalar (faqat shu conversationId uchun)
    const convRule = matchConversationRule(u, conversationId)
    if (convRule) {
      const t = isRu ? String(convRule.reply_ru ?? '') : String(convRule.reply_uz ?? '')
      if (t.trim()) {
        return res.json({
          ok: true,
          stage: 'offer',
          mode: 'conversation_rule',
          intent,
          text: t.trim(),
        })
      }
    }

    // 1) Global KB qoidalari
    const rule = matchRule(u, topic)
    if (rule) {
      return res.json({
        ok: true,
        stage: 'offer',
        mode: 'rule',
        intent,
        text: isRu ? String(rule.reply_ru ?? '') : String(rule.reply_uz ?? ''),
      })
    }

    const provider = String(process.env.LLM_PROVIDER || 'openai').toLowerCase()
    const openaiKey = process.env.OPENAI_API_KEY
    const qwenKey = process.env.QWEN_API_KEY
    const hasKey = provider === 'qwen' ? Boolean(qwenKey) : Boolean(openaiKey)

    const templateReply =
      intent === 'fees' || intent === 'transfers'
        ? (isRu
            ? 'Понимаю. По комиссии: она зависит от канала и тарифа. Я быстро проверю тариф в системе SQB и сразу озвучу итоговую сумму и срок проведения; если речь про SWIFT — также уточню возможные комиссии банка-корреспондента.'
            : "Tushundim. Komissiya kanal va tarifga bog‘liq bo‘ladi. SQB tizimidan tarifni tez tekshirib, aynan sizning holatingiz uchun komissiya va o‘tkazma muddatini aytib beraman; agar SWIFT bo‘lsa, korrespondent bank komissiyasi ham bo‘lishi mumkinligini oldindan aytib o‘taman.")
        : intent === 'cards'
          ? (isRu
              ? 'Понимаю. По картам комиссии зависят от типа карты. По вашей истории я предложу самый подходящий вариант (для онлайн‑платежей/поездок/валюты) и сразу озвучу обслуживание и ключевые комиссии после проверки тарифа.'
              : "Tushundim. Kartalarda komissiya va xizmat haqi karta turiga bog‘liq. Tarixingizga qarab sizga eng mos kartani (onlayn/safar/valyuta) tavsiya qilaman va tarifni tekshirib, xizmat haqi hamda asosiy komissiyalarni aniq aytib beraman.")
          : (isRu
              ? 'Понимаю. По вашей истории и скорингу я предложу самый подходящий вариант SQB без лишних обещаний: объясню условия, риски и следующий шаг. Точные цифры (ставка/лимит) озвучу после проверки в системе.'
              : "Tushundim. Tarixingiz va skoringingizga qarab sizga mos SQB yechimini taklif qilaman, shartlarini shaffof tushuntiraman. Aniq raqamlar (stavka/limit) tizimda tekshirilgandan keyin aytiladi.")

    if (!hasKey) {
      // fallback: fast, synthetic-data-aware reply (no questions)
      return res.json({
        ok: true,
        stage: 'offer',
        mode: 'template',
        intent,
        text: templateReply,
      })
    }

    const convIdStr = conversationId != null && String(conversationId).trim() ? String(conversationId).trim() : ''
    const topicRule = [
      convIdStr ? `CONVERSATION_ID: "${convIdStr}". Use it only for scope; do not mention the id to the customer unless asked.` : '',
      topic
        ? `CHAT_TOPIC: "${String(topic)}". CRITICAL: Answer ONLY within CHAT_TOPIC. The same chat may include several different questions — all must stay inside CHAT_TOPIC (e.g. cards: fees, limits, abroad usage, block). If user asks off-topic, politely say this chat is only for CHAT_TOPIC and they should open another chat for other products. Do NOT answer off-topic.`
        : '',
      playbook
        ? isRu
          ? `TOPIC_ORIENTATION: ${String(playbook.coach_ru ?? '')} Typical angles: ${(Array.isArray(playbook.typical_angles_ru) ? playbook.typical_angles_ru : []).join(' | ')}.`
          : `TOPIC_ORIENTATION: ${String(playbook.coach_uz ?? '')} Kutiladigan burchaklar: ${(Array.isArray(playbook.typical_angles_uz) ? playbook.typical_angles_uz : []).join(' | ')}.`
        : '',
    ]
      .filter(Boolean)
      .join(' ')

    const sys = [
      'You are a call-center sales assistant for a bank in Uzbekistan.',
      'Write ONE operator reply the agent can say out loud.',
      'Language: Uzbek (Latin). If customer utterance is Russian, reply in Russian.',
      'Write 3-5 short sentences (natural, human-like, not robotic).',
      'Be polite, compliant, no absolute guarantees. Avoid definitive promises about approval/limit/rate.',
      'CRITICAL: Do NOT ask questions. Do NOT invent specific numbers (rates/fees/limits).',
      'CRITICAL: Use only APPROVED_BANK_FACTS and SQB_SITE_SNIPPETS and SQB_SITE_PAGES for factual statements.',
      'Use CUSTOMER_CONTEXT (may be synthetic) to personalize the recommendation and explain WHY (1 short sentence).',
      topicRule,
    ].join(' ')

    const userJson = JSON.stringify(
      {
        conversation_id: convIdStr || null,
        customer_utterance: u,
        topic: topic ?? null,
        TOPIC_PLAYBOOK: playbook
          ? {
              coach_uz: playbook.coach_uz ?? '',
              coach_ru: playbook.coach_ru ?? '',
              typical_angles_uz: Array.isArray(playbook.typical_angles_uz) ? playbook.typical_angles_uz : [],
              typical_angles_ru: Array.isArray(playbook.typical_angles_ru) ? playbook.typical_angles_ru : [],
            }
          : null,
        customer_profile: profile ?? null,
        customer_context: cust.context,
        APPROVED_BANK_FACTS: grounding.grounds,
        SQB_SITE_SNIPPETS: snippets.map((s) => ({
          source: s.source,
          url: s.url,
          text: isRu ? s.text_ru : s.text_uz,
        })),
        SQB_SITE_PAGES: kbPages,
        intent,
      },
      null,
      0,
    )

    let r
    try {
      if (provider === 'qwen') {
        const baseUrl = String(process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, '')
        const model = process.env.QWEN_MODEL || 'qwen-turbo'
        const payload = {
          model,
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: userJson },
          ],
          temperature: 0.3,
          max_tokens: 220,
        }
        r = await fetchWithTimeout(
          `${baseUrl}/chat/completions`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${String(qwenKey)}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          },
          1600,
        )
      } else {
        // OpenAI Responses API (default)
        const payload = {
          model: process.env.OPENAI_MODEL || 'gpt-5.4-mini',
          input: [
            { role: 'system', content: sys },
            { role: 'user', content: userJson },
          ],
          max_output_tokens: 220,
        }
        r = await fetchWithTimeout(
          'https://api.openai.com/v1/responses',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${String(openaiKey)}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          },
          1600,
        )
      }
    } catch (e) {
      // Timeout / network error -> keep SLA with fast template
      return res.json({ ok: true, stage: 'offer', mode: 'template', intent, text: templateReply })
    }

    if (!r.ok) {
      const t = await r.text()
      return res.status(502).json({ ok: false, error: `LLM error: ${t}` })
    }

    const j = await r.json()
    const text =
      provider === 'qwen'
        ? String(j?.choices?.[0]?.message?.content ?? '').trim()
        : (j.output_text && String(j.output_text).trim()) ||
          (Array.isArray(j.output)
            ? j.output
                .flatMap((o) => o.content ?? [])
                .map((c) => c.text ?? '')
                .join('\n')
                .trim()
            : '')

    return res.json({ ok: true, stage: 'offer', mode: provider === 'qwen' ? 'qwen' : 'openai', text, grounds: grounding.grounds })
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) })
  }
})

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/kb/status', (_req, res) => {
  res.json({
    ok: true,
    refreshedAt: kb.refreshedAt,
    inFlight: kb.inFlight,
    pages: kb.pages.map((p) => ({ url: p.url, title: p.title, chars: p.text.length })),
    lastError: kb.lastError,
  })
})

app.post('/kb/refresh', async (_req, res) => {
  await refreshKb()
  res.json({ ok: true, refreshedAt: kb.refreshedAt, inFlight: kb.inFlight, lastError: kb.lastError })
})

app.get('/env-check', (_req, res) => {
  const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  const apiKey = process.env.GOOGLE_STT_API_KEY

  if (!credsPath && !apiKey) {
    return res.status(400).json({
      ok: false,
      error:
        'No credentials found. Set GOOGLE_APPLICATION_CREDENTIALS (recommended) or GOOGLE_STT_API_KEY in backend/.env',
    })
  }

  if (credsPath) {
    const p = path.resolve(credsPath)
    if (!fs.existsSync(p)) {
      return res.status(400).json({ ok: false, error: `Credential JSON not found at: ${p}` })
    }
    try {
      const raw = fs.readFileSync(p, 'utf8')
      const json = JSON.parse(raw)
      const hasEmail = typeof json.client_email === 'string' && json.client_email.includes('@')
      const hasKey = typeof json.private_key === 'string' && json.private_key.includes('BEGIN PRIVATE KEY')
      return res.json({
        ok: true,
        mode: 'service_account_json',
        client_email: hasEmail ? json.client_email : '(missing client_email)',
        private_key_present: hasKey,
      })
    } catch (e) {
      return res.status(400).json({ ok: false, error: `Failed to read/parse JSON: ${String(e)}` })
    }
  }

  return res.json({ ok: true, mode: 'api_key', api_key_present: Boolean(apiKey) })
})

app.post('/stt', upload.single('audio'), async (req, res) => {
  try {
    const lang = typeof req.query.lang === 'string' ? req.query.lang : 'uz-UZ'
    const mime = req.file?.mimetype ?? ''
    const buf = req.file?.buffer

    if (!buf || buf.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'No audio uploaded. Use multipart/form-data with field name "audio".',
      })
    }

    // Hackathon default: browser MediaRecorder => audio/webm;codecs=opus (WEBM_OPUS)
    // If you send wav/linear16 later, switch encoding accordingly.
    const isWebm = mime.includes('webm')
    const isOgg = mime.includes('ogg')
    const encoding = isWebm ? 'WEBM_OPUS' : isOgg ? 'OGG_OPUS' : undefined
    const sampleRateHertz = encoding ? 48000 : undefined

    const request = {
      config: {
        languageCode: lang,
        enableAutomaticPunctuation: true,
        ...(encoding ? { encoding } : {}),
        ...(sampleRateHertz ? { sampleRateHertz } : {}),
      },
      audio: {
        content: buf.toString('base64'),
      },
    }

    const [resp] = await speechClient.recognize(request)
    const text =
      resp.results?.map((r) => r.alternatives?.[0]?.transcript ?? '').join(' ').trim() ?? ''

    return res.json({
      ok: true,
      lang,
      mime,
      bytes: buf.length,
      text,
    })
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) })
  }
})

// --- HTTP + WebSocket (STT streaming) ---
const server = http.createServer(app)

const wss = new WebSocketServer({ server, path: '/stt-stream' })
wss.on('connection', (ws) => {
  let recognizeStream = null
  let started = false
  let lang = 'uz-UZ'
  let altLangs = []
  let bytesIn = 0
  console.log('[stt] ws connected')
  const statsTimer = setInterval(() => {
    try {
      ws.send(JSON.stringify({ type: 'stats', bytesIn }))
    } catch {
      // ignore
    }
  }, 1000)

  const start = (maybeLang, maybeAltLangs) => {
    // Allow restart if stream got destroyed
    if (started && recognizeStream) return
    started = true
    lang = typeof maybeLang === 'string' ? maybeLang : 'uz-UZ'
    altLangs = Array.isArray(maybeAltLangs) ? maybeAltLangs.filter((x) => typeof x === 'string') : []
    altLangs = altLangs.filter((x) => x && x !== lang).slice(0, 3)
    console.log('[stt] start', { lang, altLangs })

    // Some Google models/options are language-dependent; keep safe defaults for Uzbek.
    const isRu = /^ru/i.test(lang) || altLangs.some((x) => /^ru/i.test(String(x)))
    // IMPORTANT: some models (e.g. phone_call / enhanced) don't support alternativeLanguageCodes.
    // Rule: if we are using alt langs, keep model default; if no alt langs and RU, use phone_call+enhanced.
    const hasAlt = altLangs.length > 0
    const maybeEnhanced = !hasAlt && isRu ? { model: 'phone_call', useEnhanced: true } : {}

    recognizeStream = speechClient
      .streamingRecognize({
        config: {
          encoding: 'LINEAR16',
          sampleRateHertz: 16000,
          languageCode: lang,
          ...(hasAlt ? { alternativeLanguageCodes: altLangs } : {}),
          enableAutomaticPunctuation: true,
          ...maybeEnhanced,
          // Light phrase hints for Uzbek/Russian banking vocabulary (helps a lot on demos)
          speechContexts: [
            {
              phrases: [
                // Uzbek / Latin
                "komissiya",
                "foiz",
                "tarif",
                "karta",
                "kredit",
                "mikrokredit",
                "ipoteka",
                "depozit",
                "pul o'tkazma",
                "valyuta",
                "konvertatsiya",
                "hisob raqami",
                "PIN",
                "SMS",
                "mobil ilova",
                // Russian
                "комиссия",
                "процент",
                "тариф",
                "карта",
                "кредит",
                "ипотека",
                "депозит",
                "перевод",
                "валюта",
                "конвертация",
                "счёт",
                "смс",
                "мобильное приложение",
              ],
              boost: 6,
            },
          ],
        },
        interimResults: true,
      })
      .on('error', (err) => {
        console.error('[stt] recognize error', err)
        try {
          recognizeStream?.destroy?.()
        } catch {
          // ignore
        }
        recognizeStream = null
        try {
          ws.send(JSON.stringify({ type: 'error', error: String(err) }))
        } catch {
          // ignore
        }
      })
      .on('data', (data) => {
        const r = data.results?.[0]
        const alt = r?.alternatives?.[0]
        const transcript = alt?.transcript ?? ''
        const isFinal = Boolean(r?.isFinal)
        if (!transcript) return
        try {
          ws.send(JSON.stringify({ type: 'transcript', transcript, isFinal, lang }))
        } catch {
          // ignore
        }
      })
  }

  ws.on('message', (msg, isBinary) => {
    try {
      if (!started && !isBinary) {
        const text = msg.toString()
        const j = JSON.parse(text)
        if (j?.type === 'start') start(j.lang, j.altLangs)
        return
      }
      if (!started || !recognizeStream) start(lang, altLangs)
      if (!recognizeStream) return
      if (isBinary) {
        bytesIn += msg.length ?? 0
        try {
          recognizeStream.write(msg)
        } catch (e) {
          console.error('[stt] write failed, restarting stream', e)
          try {
            recognizeStream?.destroy?.()
          } catch {}
          recognizeStream = null
        }
      } else {
        // ignore text frames once started
      }
    } catch (e) {
      try {
        ws.send(JSON.stringify({ type: 'error', error: String(e) }))
      } catch {
        // ignore
      }
    }
  })

  ws.on('close', () => {
    clearInterval(statsTimer)
    console.log('[stt] ws closed', { bytesIn })
    try {
      recognizeStream?.end()
    } catch {
      // ignore
    }
  })
})

const port = Number(process.env.PORT || 3001)
server.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`)
  console.log(`STT WS: ws://localhost:${port}/stt-stream`)
  // best-effort preload; reply path uses cached pages for <2s latency
  void refreshKb()
})

