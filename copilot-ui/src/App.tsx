import { useEffect, useMemo, useRef, useState } from 'react'
import sqbWatermark from './assets/sqb-watermark.png'
import sqbMark from './assets/sqb-mark.png'
import SmsCampaign from './pages/SmsCampaign'
import './App.css'

/** Local yoki ngrok orqali backend. `copilot-ui/.env.local` da VITE_API_BASE_URL */
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, '') || 'http://localhost:3001'

function sttWebSocketUrl(): string {
  const b = API_BASE
  if (b.startsWith('https://')) return `${b.replace(/^https:\/\//i, 'wss://')}/stt-stream`
  if (b.startsWith('http://')) return `${b.replace(/^http:\/\//i, 'ws://')}/stt-stream`
  return 'ws://localhost:3001/stt-stream'
}

function apiJsonHeaders(): HeadersInit {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (/ngrok/i.test(API_BASE)) {
    h['ngrok-skip-browser-warning'] = '69420'
  }
  return h
}

type Speaker = 'agent' | 'customer' | 'system'

type TranscriptLine = {
  id: string
  t: string
  speaker: Speaker
  text: string
  isFinal?: boolean
}

type CustomerProfile = {
  id: string
  firstName: string
  lastName: string
  phone: string
  passport: string
  birthDate: string
  segment: 'Mass' | 'Affluent' | 'SME'
  language: 'UZ' | 'RU' | 'UZ/RU'
}

type Conversation = {
  id: string
  customer: CustomerProfile
  topic: string
  transcript: TranscriptLine[]
  checklist: ChecklistItem[]
  lastUpdatedAt: number
  aiDraft?: AiDraft | null
}

type ChecklistItem = {
  id: string
  label: string
  done: boolean
  severity?: 'info' | 'warn' | 'critical'
}

type ConsentStatus = 'notAsked' | 'pending' | 'granted' | 'declined' | 'expired'

type AiDraft = {
  title: string
  text: string
  confidence: number
  updatedAt: number
}

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16)
}

function nowT() {
  const d = new Date()
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function App() {
  const [appView, setAppView] = useState<'copilot' | 'sms'>('copilot')
  const [consent, setConsent] = useState<ConsentStatus>('notAsked');
  const [callState, setCallState] = useState<'idle' | 'connected'>('idle')
  const [sttPaused, setSttPaused] = useState(false)
  const [sttLangMode, setSttLangMode] = useState<'auto' | 'uz' | 'ru'>('auto')
  const [sttState, setSttState] = useState<'idle' | 'recording' | 'sending' | 'error'>('idle')
  const [sttError, setSttError] = useState<string>('')
  const [sttDebug, setSttDebug] = useState<{ frames: number; level: number }>({ frames: 0, level: 0 })
  const [sttBytesIn, setSttBytesIn] = useState<number>(0)
  const [sttInterim, setSttInterim] = useState<string>('')
  const checklistTemplate = useMemo<ChecklistItem[]>(
    () => [
      { id: 'need_amount', label: 'Summa (qancha kerak?)', done: false, severity: 'critical' },
      { id: 'need_term', label: 'Muddat (qancha vaqtga?)', done: false, severity: 'critical' },
      { id: 'kyc_income_source', label: 'Daromad manbaini so‘rash', done: false, severity: 'critical' },
      { id: 'kyc_purpose', label: 'Mablag‘ maqsadini so‘rash', done: false, severity: 'critical' },
      { id: 'existing_obligations', label: 'Mavjud kredit/majburiyatlar bormi?', done: false, severity: 'warn' },
      { id: 'kyc_pep', label: 'PEP/sanksiya tekshiruvi (tasdiq)', done: false, severity: 'warn' },
      { id: 'disclosure_rate', label: 'Foiz/komissiya disclosure aytildi', done: false, severity: 'critical' },
      { id: 'privacy_notice', label: 'Ma’lumotlarni qayta ishlash roziligi (call)', done: false, severity: 'warn' },
    ],
    [],
  )

  const STORAGE_KEY = 'ai-sha.copilot.conversations.v3'

  const [conversations, setConversations] = useState<Conversation[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Conversation[]
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      }
    } catch {
      // ignore
    }
    const mk = (c: CustomerProfile, topic: string, seedLines: TranscriptLine[]): Conversation => ({
      id: uid(),
      customer: c,
      topic,
      transcript: seedLines,
      checklist: checklistTemplate.map((x) => ({ ...x })),
      lastUpdatedAt: Date.now() - Math.floor(Math.random() * 60_000),
      aiDraft: null,
    })

    return [
      mk(
        {
          id: 'C-102938',
          firstName: 'Aziza',
          lastName: 'Karimova',
          phone: '+998 90 123 45 67',
          passport: 'AA1234567',
          birthDate: '1998-04-12',
          segment: 'Mass',
          language: 'UZ/RU',
        },
        'Avtokredit',
        [
          { id: uid(), t: nowT(), speaker: 'system', text: 'Suhbat ochildi. Real-time yordamchi tayyor.' },
          { id: uid(), t: nowT(), speaker: 'customer', text: 'Assalomu alaykum, menga tezroq kredit kerak edi.' },
          { id: uid(), t: nowT(), speaker: 'agent', text: 'Albatta. Qaysi maqsad uchun kerakligini aytsangiz?' },
        ],
      ),
      mk(
        {
          id: 'C-334455',
          firstName: 'Javohir',
          lastName: 'Rahmonov',
          phone: '+998 93 555 77 88',
          passport: 'AB7654321',
          birthDate: '1992-11-02',
          segment: 'Affluent',
          language: 'UZ',
        },
        'Depozit',
        [
          { id: uid(), t: nowT(), speaker: 'system', text: 'Suhbat ochildi. Real-time yordamchi tayyor.' },
          { id: uid(), t: nowT(), speaker: 'customer', text: 'Depozit foizlari bo‘yicha ma’lumot kerak.' },
        ],
      ),
      mk(
        {
          id: 'C-778899',
          firstName: 'Olga',
          lastName: 'Sidorova',
          phone: '+998 99 777 88 99',
          passport: 'AC2468101',
          birthDate: '1989-07-21',
          segment: 'Mass',
          language: 'RU',
        },
        'Karta',
        [
          { id: uid(), t: nowT(), speaker: 'system', text: 'Suhbat ochildi. Real-time yordamchi tayyor.' },
          { id: uid(), t: nowT(), speaker: 'customer', text: 'Мне нужна карта для поездок и оплаты онлайн.' },
        ],
      ),
      mk(
        {
          id: 'C-440011',
          firstName: 'Sardor',
          lastName: 'Islomov',
          phone: '+998 97 440 01 10',
          passport: 'AD1357913',
          birthDate: '1996-09-18',
          segment: 'Mass',
          language: 'UZ',
        },
        'Kredit karta',
        [
          { id: uid(), t: nowT(), speaker: 'system', text: 'Suhbat ochildi. Real-time yordamchi tayyor.' },
          { id: uid(), t: nowT(), speaker: 'customer', text: 'Kredit karta ochsam bo‘ladimi? Limit qancha beriladi?' },
        ],
      ),
      mk(
        {
          id: 'C-550022',
          firstName: 'Malika',
          lastName: 'To‘xtayeva',
          phone: '+998 90 550 02 20',
          passport: 'AE0246802',
          birthDate: '2000-02-05',
          segment: 'Mass',
          language: 'UZ',
        },
        'Mikrokredit',
        [
          { id: uid(), t: nowT(), speaker: 'system', text: 'Suhbat ochildi. Real-time yordamchi tayyor.' },
          { id: uid(), t: nowT(), speaker: 'customer', text: '50 milliongacha tez pul kerak, shartlari qanday?' },
        ],
      ),
      mk(
        {
          id: 'C-660033',
          firstName: 'Rustam',
          lastName: 'Qodirov',
          phone: '+998 91 660 03 30',
          passport: 'AF1122334',
          birthDate: '1987-12-30',
          segment: 'SME',
          language: 'UZ/RU',
        },
        'Biznes kredit',
        [
          { id: uid(), t: nowT(), speaker: 'system', text: 'Suhbat ochildi. Real-time yordamchi tayyor.' },
          { id: uid(), t: nowT(), speaker: 'customer', text: 'Aylanma uchun biznes kredit kerak. Garov shartmi?' },
        ],
      ),
      mk(
        {
          id: 'C-770044',
          firstName: 'Dilshod',
          lastName: 'Ergashev',
          phone: '+998 93 770 04 40',
          passport: 'AG5566778',
          birthDate: '1994-06-11',
          segment: 'Mass',
          language: 'UZ',
        },
        'Pul o‘tkazma',
        [
          { id: uid(), t: nowT(), speaker: 'system', text: 'Suhbat ochildi. Real-time yordamchi tayyor.' },
          { id: uid(), t: nowT(), speaker: 'customer', text: 'Rossiyadan pul tushadi, komissiya qanday?' },
        ],
      ),
      mk(
        {
          id: 'C-880055',
          firstName: 'Nargiza',
          lastName: 'Usmonova',
          phone: '+998 95 880 05 50',
          passport: 'AH8899001',
          birthDate: '1999-03-27',
          segment: 'Mass',
          language: 'UZ',
        },
        'Ipoteka',
        [
          { id: uid(), t: nowT(), speaker: 'system', text: 'Suhbat ochildi. Real-time yordamchi tayyor.' },
          { id: uid(), t: nowT(), speaker: 'customer', text: 'Ipoteka uchun boshlang‘ich to‘lov nechchi foiz?' },
        ],
      ),
      mk(
        {
          id: 'C-990066',
          firstName: 'Timur',
          lastName: 'Petrov',
          phone: '+998 98 990 06 60',
          passport: 'AJ1010101',
          birthDate: '1991-01-14',
          segment: 'Affluent',
          language: 'RU',
        },
        'Premium karta',
        [
          { id: uid(), t: nowT(), speaker: 'system', text: 'Suhbat ochildi. Real-time yordamchi tayyor.' },
          { id: uid(), t: nowT(), speaker: 'customer', text: 'Хочу премиальную карту. Какие преимущества и комиссия?' },
        ],
      ),
      mk(
        {
          id: 'C-120077',
          firstName: 'Shahnoza',
          lastName: 'Nazarova',
          phone: '+998 94 120 07 70',
          passport: 'AK3141592',
          birthDate: '1997-08-09',
          segment: 'Mass',
          language: 'UZ',
        },
        'Onlayn bank',
        [
          { id: uid(), t: nowT(), speaker: 'system', text: 'Suhbat ochildi. Real-time yordamchi tayyor.' },
          { id: uid(), t: nowT(), speaker: 'customer', text: 'Ilovadan parol esdan chiqdi, qanday tiklayman?' },
        ],
      ),
      mk(
        {
          id: 'C-130088',
          firstName: 'Otabek',
          lastName: 'Mirzayev',
          phone: '+998 99 130 08 80',
          passport: 'AL2718281',
          birthDate: '1985-05-23',
          segment: 'Mass',
          language: 'UZ/RU',
        },
        'Valyuta',
        [
          { id: uid(), t: nowT(), speaker: 'system', text: 'Suhbat ochildi. Real-time yordamchi tayyor.' },
          { id: uid(), t: nowT(), speaker: 'customer', text: 'Dollar sotib olish/sotish kurslari qanaqa? Limit bormi?' },
        ],
      ),
      mk(
        {
          id: 'C-140099',
          firstName: 'Madina',
          lastName: 'Rasulova',
          phone: '+998 90 140 09 90',
          passport: 'AM4242424',
          birthDate: '2001-10-01',
          segment: 'Mass',
          language: 'UZ',
        },
        'Keshbek karta',
        [
          { id: uid(), t: nowT(), speaker: 'system', text: 'Suhbat ochildi. Real-time yordamchi tayyor.' },
          { id: uid(), t: nowT(), speaker: 'customer', text: 'Keshbekli karta bormi? Qaysi toifalarda keshbek ko‘proq?' },
        ],
      ),
    ]
  })

  const [activeConversationId, setActiveConversationId] = useState<string>(() => conversations[0]?.id ?? '')
  const [peopleFilter, setPeopleFilter] = useState('')
  const [profileOpenId, setProfileOpenId] = useState<string | null>(null)
  const [leftMode, setLeftMode] = useState<'list' | 'profile'>('list')
  const [addOpen, setAddOpen] = useState(false)
  const [addPassport, setAddPassport] = useState('')
  const activeConversationIdRef = useRef<string>(activeConversationId)

  // Audio recording (saved per conversation in-memory; downloadable)
  const callRecorderRef = useRef<MediaRecorder | null>(null)
  const callRecordChunksRef = useRef<BlobPart[]>([])
  const audioByConversationRef = useRef<Map<string, Blob>>(new Map())
  const [audioAvailableTick, setAudioAvailableTick] = useState(0)

  const peopleListRef = useRef<HTMLDivElement | null>(null)
  const chatStreamRef = useRef<HTMLDivElement | null>(null)
  const aiDockRef = useRef<HTMLDivElement | null>(null)
  const chatBottomRef = useRef<HTMLDivElement | null>(null)
  const sttPausedRef = useRef(false)
  const sttLangPrimaryRef = useRef<'uz-UZ' | 'ru-RU'>('uz-UZ')
  const sttLastLangSwitchAtRef = useRef<number>(0)
  const sttLangModeRef = useRef<'auto' | 'uz' | 'ru'>('auto')

  function maybeAutoScroll(el: HTMLDivElement | null) {
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceFromBottom < 120) el.scrollTop = el.scrollHeight
  }

  function detectLangFromText(t: string): 'uz-UZ' | 'ru-RU' {
    // quick heuristic: Cyrillic => RU, otherwise default to UZ (Latin)
    return /[\u0400-\u04FF]/.test(t) ? 'ru-RU' : 'uz-UZ'
  }

  function openSttWs(primary: 'uz-UZ' | 'ru-RU') {
    const ws = new WebSocket(sttWebSocketUrl())
    sttWsRef.current = ws
    ws.onopen = () => {
      const alt = primary === 'uz-UZ' ? ['ru-RU'] : ['uz-UZ']
      ws.send(JSON.stringify({ type: 'start', lang: primary, altLangs: alt }))
      pushLine('system', `STT WS ulandi. Auto til: ${primary === 'uz-UZ' ? 'UZ/RU' : 'RU/UZ'}…`)
    }
    ws.onmessage = (ev) => {
      try {
        const j = JSON.parse(String(ev.data))
        if (j.type === 'stats') {
          setSttBytesIn(Number(j.bytesIn ?? 0))
        } else if (j.type === 'transcript' && j.transcript) {
          const txt = String(j.transcript)
          if (j.isFinal) {
            interimRef.current = ''
            setSttInterim('')
            pushLine('customer', txt, true)

            // Auto-switch primary language bias based on detected script (avoid flapping)
            if (sttLangModeRef.current !== 'auto') return
            const desired = detectLangFromText(txt)
            const now = Date.now()
            if (desired !== sttLangPrimaryRef.current && now - sttLastLangSwitchAtRef.current > 6000) {
              sttLangPrimaryRef.current = desired
              sttLastLangSwitchAtRef.current = now
              try {
                sttWsRef.current?.close()
              } catch {}
              // reopen WS with new bias; audio pipeline keeps running and will resume sending to new socket
              openSttWs(desired)
              pushLine('system', `STT auto: ${desired === 'ru-RU' ? 'RU' : 'UZ'} tiliga o‘tdi.`)
            }
          } else {
            interimRef.current = txt
            setSttInterim(txt)
          }
        } else if (j.type === 'error') {
          setSttState('error')
          setSttError(String(j.error ?? 'WS STT error'))
          pushLine('system', `STT WS error: ${String(j.error ?? '')}`)
          // Auto-reconnect while call is active (backend may restart recognizer)
          if (sttActiveRef.current) {
            window.setTimeout(() => {
              try {
                if (!sttActiveRef.current) return
                const desired: 'uz-UZ' | 'ru-RU' = sttLangPrimaryRef.current
                openSttWs(desired)
                pushLine('system', 'STT WS qayta ulandi (auto-reconnect).')
              } catch {
                // ignore
              }
            }, 700)
          }
        }
      } catch {
        // ignore
      }
    }
    ws.onerror = () => {
      setSttState('error')
      setSttError('WS connection error (STT).')
    }
    ws.onclose = () => {
      // don't force idle while call is active; close can happen during auto language switch
      interimRef.current = ''
      setSttInterim('')
    }
  }

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) ?? conversations[0],
    [activeConversationId, conversations],
  )

  const profileConversation = useMemo(
    () => (profileOpenId ? conversations.find((c) => c.id === profileOpenId) : null),
    [conversations, profileOpenId],
  )

  const filteredConversations = useMemo(() => {
    const q = peopleFilter.trim().toLowerCase()
    const list = [...conversations].sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt)
    if (!q) return list
    return list.filter((c) => {
      const p = c.customer
      return (
        p.phone.toLowerCase().includes(q) ||
        p.firstName.toLowerCase().includes(q) ||
        p.lastName.toLowerCase().includes(q) ||
        p.passport.toLowerCase().includes(q)
      )
    })
  }, [conversations, peopleFilter])

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId
  }, [activeConversationId])

  useEffect(() => {
    sttPausedRef.current = sttPaused
    if (sttPaused) setSttInterim('')
  }, [sttPaused])

  useEffect(() => {
    sttLangModeRef.current = sttLangMode
    if (callState !== 'connected') return
    const primary: 'uz-UZ' | 'ru-RU' = sttLangMode === 'ru' ? 'ru-RU' : 'uz-UZ'
    sttLangPrimaryRef.current = primary
    sttLastLangSwitchAtRef.current = Date.now()
    try {
      sttWsRef.current?.close()
    } catch {}
    openSttWs(primary)
    pushLine('system', `STT tili: ${sttLangMode.toUpperCase()}.`)
  }, [sttLangMode, callState])

  useEffect(() => {
    // Hold SPACE to pause STT while operator speaks (demo diarization workaround)
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      const t = e.target as HTMLElement | null
      const tag = t?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || (t as any)?.isContentEditable) return
      if (callState !== 'connected') return
      e.preventDefault()
      setSttPaused(true)
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      if (callState !== 'connected') return
      e.preventDefault()
      setSttPaused(false)
    }
    window.addEventListener('keydown', onDown, { passive: false })
    window.addEventListener('keyup', onUp, { passive: false })
    return () => {
      window.removeEventListener('keydown', onDown as any)
      window.removeEventListener('keyup', onUp as any)
    }
  }, [callState])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations))
    } catch {
      // ignore
    }
  }, [conversations])

  useEffect(() => {
    // On switching chats, always scroll the chat panel to bottom
    if (!chatStreamRef.current) return
    chatStreamRef.current.scrollTop = chatStreamRef.current.scrollHeight
  }, [activeConversationId])

  useEffect(() => {
    // Always follow new messages (demo UX)
    const el = chatBottomRef.current
    if (!el) return
    // next frame ensures DOM height is updated
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          el.scrollIntoView({ block: 'end' })
        } catch {
          el.scrollIntoView()
        }
      })
    })
  }, [activeConversation?.transcript.length, sttInterim])

  function downloadActiveChat(format: 'txt' | 'json') {
    if (!activeConversation) return
    const c = activeConversation
    const safe = `${c.customer.firstName}_${c.customer.lastName}_${c.customer.phone}`.replace(/[^\w+]+/g, '_')
    const filename = `chat_${safe}.${format}`

    let blob: Blob
    if (format === 'json') {
      blob = new Blob([JSON.stringify(c, null, 2)], { type: 'application/json;charset=utf-8' })
    } else {
      const text = c.transcript
        .map((l) => `[${l.t}] ${l.speaker.toUpperCase()}: ${l.text}`)
        .join('\n')
      blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    }

    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  function downloadActiveAudio() {
    // force rerender dependency so button reflects availability
    void audioAvailableTick
    const convId = activeConversationIdRef.current
    if (!convId) return
    const blob = audioByConversationRef.current.get(convId)
    if (!blob) return
    const filename = `call_audio_${convId}.webm`
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  function deleteConversation(convId: string) {
    // remove audio blob if present
    try {
      audioByConversationRef.current.delete(convId)
    } catch {}

    setConversations((prev) => prev.filter((c) => c.id !== convId))

    if (activeConversationIdRef.current === convId) {
      // pick next available conversation (if any)
      const next = conversations.find((c) => c.id !== convId) ?? null
      setActiveConversationId(next?.id ?? '')
    }

    if (profileOpenId === convId) {
      setProfileOpenId(null)
      setLeftMode('list')
    }
  }

  function normalizePassport(p: string) {
    return p.replace(/\s+/g, '').toUpperCase()
  }

  function seededRand(seed: number) {
    let x = seed | 0
    return () => {
      // xorshift32
      x ^= x << 13
      x ^= x >>> 17
      x ^= x << 5
      return ((x >>> 0) % 10_000) / 10_000
    }
  }

  function buildSyntheticProfile(passport: string): CustomerProfile {
    const p = normalizePassport(passport)
    let seed = 0
    for (let i = 0; i < p.length; i++) seed = (seed * 31 + p.charCodeAt(i)) | 0
    const r = seededRand(seed)

    const firstNames = ['Otabek', 'Malika', 'Dilshod', 'Aziza', 'Sardor', 'Nargiza', 'Shahnoza', 'Rustam', 'Madina', 'Javohir']
    const lastNames = ['Mirzayev', 'To‘xtayeva', 'Ergashev', 'Karimova', 'Islomov', 'Usmonova', 'Nazarova', 'Qodirov', 'Rasulova', 'Rahmonov']
    const segs: CustomerProfile['segment'][] = ['Mass', 'Mass', 'Mass', 'Affluent', 'SME']
    const langs: CustomerProfile['language'][] = ['UZ', 'UZ', 'UZ/RU', 'RU']
    const topics = ['Kredit', 'Mikrokredit', 'Kartalar', 'Pul o‘tkazma', 'Valyuta', 'Ipoteka', 'Depozit']

    const fn = firstNames[Math.floor(r() * firstNames.length)]
    const ln = lastNames[Math.floor(r() * lastNames.length)]
    const segment = segs[Math.floor(r() * segs.length)]
    const language = langs[Math.floor(r() * langs.length)]
    const topic = topics[Math.floor(r() * topics.length)]

    const phone = `+998 ${(90 + Math.floor(r() * 9)).toString().padStart(2, '0')} ${Math.floor(r() * 900 + 100)} ${Math.floor(r() * 90 + 10)} ${Math.floor(r() * 90 + 10)}`
    const year = 1985 + Math.floor(r() * 16)
    const month = 1 + Math.floor(r() * 12)
    const day = 1 + Math.floor(r() * 28)
    const birthDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

    return {
      id: `C-${Math.floor(r() * 900000 + 100000)}`,
      firstName: fn,
      lastName: ln,
      phone,
      passport: p || passport,
      birthDate,
      segment,
      language,
      // @ts-expect-error topic is used when adding conversation
      topic,
    }
  }

  const addPreview = useMemo(() => {
    const p = normalizePassport(addPassport)
    if (p.length < 5) return null
    const existing = conversations.find((c) => normalizePassport(c.customer.passport) === p)
    if (existing) return { kind: 'existing' as const, conversationId: existing.id, profile: existing.customer, topic: existing.topic }
    const prof = buildSyntheticProfile(p) as CustomerProfile & { topic?: string }
    return { kind: 'new' as const, profile: prof, topic: String((prof as any).topic ?? 'Kredit') }
  }, [addPassport, conversations])

  function confirmAddCustomer() {
    if (!addPreview) return
    if (addPreview.kind === 'existing') {
      setActiveConversationId(addPreview.conversationId)
      setAddOpen(false)
      setAddPassport('')
      return
    }
    const profAny = addPreview.profile as CustomerProfile & { topic?: string }
    const topic = addPreview.topic
    const seedLines: TranscriptLine[] = [
      { id: uid(), t: nowT(), speaker: 'system', text: 'Yangi mijoz qo‘shildi (synthetic demo).' },
      { id: uid(), t: nowT(), speaker: 'system', text: `Pasport: ${profAny.passport}` },
    ]
    const conv: Conversation = {
      id: uid(),
      customer: { ...addPreview.profile },
      topic,
      transcript: seedLines,
      checklist: checklistTemplate.map((x) => ({ ...x })),
      lastUpdatedAt: Date.now(),
      aiDraft: null,
    }
    setConversations((prev) => [conv, ...prev])
    setActiveConversationId(conv.id)
    setAddOpen(false)
    setAddPassport('')
  }

  const [nextBestAction, setNextBestAction] = useState(() => ({
    title: 'Operator uchun tayyor replika',
    text: '',
    confidence: 0,
  }))

  useEffect(() => {
    const draft = activeConversation?.aiDraft
    if (draft?.text) {
      setNextBestAction({ title: draft.title, text: draft.text, confidence: draft.confidence })
    } else {
      setNextBestAction({ title: 'Operator uchun tayyor replika', text: '', confidence: 0 })
    }
  }, [activeConversationId])

  function setAiDraftForActive(d: { title: string; text: string; confidence: number }) {
    setNextBestAction(d)
    const convId = activeConversationIdRef.current
    if (!convId) return
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId ? { ...c, aiDraft: { ...d, updatedAt: Date.now() }, lastUpdatedAt: Date.now() } : c,
      ),
    )
  }

  useEffect(() => {
    // Auto-scroll inside chat + AI dock when content grows
    maybeAutoScroll(chatStreamRef.current)
    maybeAutoScroll(aiDockRef.current)
  }, [
    activeConversation?.transcript.length,
    nextBestAction.text,
  ])

  const aiReqIdRef = useRef(0)

  function applyChecklistSignals(utterance: string) {
    const u = utterance.toLowerCase()
    const doneIds: string[] = []
    if (/\b(\d{1,3}\s?(mln|million|млн))\b/i.test(u) || /\b\d{1,3}\s?000\s?000\b/.test(u) || /so['‘]m|сум/i.test(u)) {
      doneIds.push('need_amount')
    }
    if (/oy|oyga|oylik|месяц|месяцев|год|лет/i.test(u) || /\b\d{1,2}\s?(oy|yil|месяц|год)\b/i.test(u)) {
      doneIds.push('need_term')
    }
    if (/maqsad|ta'mir|ta’mir|avto|mashina|ta'lim|ta’lim|tibb|uy|ипотек/i.test(u)) doneIds.push('kyc_purpose')
    if (/daromad|oylik|ish haqi|karta aylanma|tushum|зарплат|доход/i.test(u)) doneIds.push('kyc_income_source')
    if (/mavjud kredit|kredit bor|kreditim bor|qarz bor|долг|кредит есть/i.test(u)) doneIds.push('existing_obligations')
    return Array.from(new Set(doneIds))
  }

  async function updateAiForCustomerUtterance(utterance: string) {
    // Real AI reply via backend (falls back to local templates if backend/OPENAI is not ready)
    const reqId = ++aiReqIdRef.current
    setAiDraftForActive({
      title: 'Operator uchun tayyor replika',
      text: 'AI javob tayyorlayapti…',
      confidence: 0.55,
    })

    const convId = activeConversationIdRef.current
    const conv = activeConversation
    const signals = applyChecklistSignals(utterance)
    const checklistSnapshot = (conv?.checklist ?? []).map((x) =>
      signals.includes(x.id) ? { ...x, done: true } : x,
    )
    if (signals.length && convId) {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? { ...c, checklist: c.checklist.map((x) => (signals.includes(x.id) ? { ...x, done: true } : x)) }
            : c,
        ),
      )
    }

    try {
      const resp = await fetch(`${API_BASE}/ai/reply`, {
        method: 'POST',
        headers: apiJsonHeaders(),
        body: JSON.stringify({
          conversationId: convId,
          utterance,
          topic: activeConversation?.topic ?? null,
          profile: activeConversation?.customer ?? null,
          checklist: checklistSnapshot,
        }),
      })
      const j = (await resp.json()) as { ok: boolean; text?: string; stage?: string }
      if (reqId === aiReqIdRef.current && j?.ok && j.text) {
        const t = String(j.text).trim()
        if (t) {
          setAiDraftForActive({ title: 'Operator uchun tayyor replika', text: t, confidence: 0.86 })
          return
        }
      }
    } catch {
      // ignore -> fallback below
    }

    // Fallback: local templates (human-like, 2–3 sentences)
    const u = utterance.toLowerCase()
    if (/kredit|loan|qarz/i.test(u)) {
      setAiDraftForActive({
        title: 'Operator uchun tayyor replika',
        text: "Tushundim. Kreditni qaysi maqsad uchun olmoqchisiz va taxminan qancha summa kerak bo‘ladi? Shularni aytsangiz, sizga mos 2–3 variantni shartlari bilan solishtirib, eng qulayini taklif qilaman.",
        confidence: 0.82,
      })
      return
    }
    if (/depozit|omonat|депозит/i.test(u)) {
      setAiDraftForActive({
        title: 'Operator uchun tayyor replika',
        text: "Albatta. Qancha summani va qaysi muddatga qo‘ymoqchisiz? Shunga qarab foiz stavkasi, yechib olish shartlari va kerak bo‘lsa kapitalizatsiya variantlarini aniq qilib aytib beraman.",
        confidence: 0.8,
      })
      return
    }
    if (/karta|карта/i.test(u)) {
      setAiDraftForActive({
        title: 'Operator uchun tayyor replika',
        text: "Albatta. Karta sizga qaysi maqsad uchun kerak: onlayn to‘lovlar, safar/valyuta xarajatlari yoki kundalik xarajatlar uchunmi? Shunga qarab eng mos kartani tanlab, xizmat haqi va limitlarini ham qisqa tushuntirib beraman.",
        confidence: 0.79,
      })
      return
    }

    setAiDraftForActive({
      title: 'Operator uchun tayyor replika',
      text: "Tushundim. Mijoz tarixini va skoring signalini tez tekshirib, sizga hozir eng mos yechimni tavsiya qilaman. Shartlar (komissiya/foiz/limit) mahsulot va tarifga bog‘liq bo‘ladi — aniq qiymatlarni tizimdan tekshirgan holda, shaffof aytib beramiz. Hozir sizga xavfsiz va tasdiqlangan skript bo‘yicha tayyor replika beraman.",
      confidence: 0.7,
    })
  }

  const interimRef = useRef<string>('')
  const sttActiveRef = useRef(false)
  const sttWsRef = useRef<WebSocket | null>(null)
  const sttLastPcmSentAtRef = useRef<number>(0)
  const sttKeepAliveTimerRef = useRef<number | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const procRef = useRef<ScriptProcessorNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  function pushLine(speaker: Speaker, text: string, isFinal = true) {
    const convId = activeConversationIdRef.current
    if (!convId) return
    const line: TranscriptLine = { id: uid(), t: nowT(), speaker, text, isFinal }
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId ? { ...c, transcript: [...c.transcript, line], lastUpdatedAt: Date.now() } : c,
      ),
    )

    if (speaker === 'customer' && isFinal) updateAiForCustomerUtterance(text)

    // Force-scroll to bottom after pushing a new line
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          chatBottomRef.current?.scrollIntoView({ block: 'end' })
        } catch {
          try {
            chatBottomRef.current?.scrollIntoView()
          } catch {
            // ignore
          }
        }
      })
    })
  }

  function downsampleTo16k(float32: Float32Array, inputRate: number): Int16Array {
    if (inputRate === 16000) {
      const out = new Int16Array(float32.length)
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]))
        out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
      }
      return out
    }
    const ratio = inputRate / 16000
    const newLen = Math.round(float32.length / ratio)
    const out = new Int16Array(newLen)
    let offsetResult = 0
    let offsetBuffer = 0
    while (offsetResult < out.length) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio)
      let accum = 0
      let count = 0
      for (let i = offsetBuffer; i < nextOffsetBuffer && i < float32.length; i++) {
        accum += float32[i]
        count++
      }
      const s = Math.max(-1, Math.min(1, accum / Math.max(1, count)))
      out[offsetResult] = s < 0 ? s * 0x8000 : s * 0x7fff
      offsetResult++
      offsetBuffer = nextOffsetBuffer
    }
    return out
  }

  async function startSttStream() {
    try {
      setSttError('')
      setSttState('recording')
      sttActiveRef.current = true
      sttLastPcmSentAtRef.current = Date.now()

      // Close any existing ws/audio
      try {
        sttWsRef.current?.close()
      } catch {
        // ignore
      }
      sttWsRef.current = null

      if (!navigator.mediaDevices?.getUserMedia) {
        setSttState('error')
        setSttError('Browser audio capture qo‘llab-quvvatlanmadi.')
        sttActiveRef.current = false
        return
      }

      // Start with selected mode (auto defaults to Uzbek primary)
      const primary: 'uz-UZ' | 'ru-RU' = sttLangModeRef.current === 'ru' ? 'ru-RU' : 'uz-UZ'
      sttLangPrimaryRef.current = primary
      sttLastLangSwitchAtRef.current = 0
      openSttWs(primary)

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          // autoGainControl can "pump" levels and hurt recognition on some mics
          autoGainControl: false,
        },
      })
      streamRef.current = stream

      // Record call audio for saving (webm/opus). This does NOT affect STT stream.
      try {
        const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
        callRecorderRef.current = mr
        callRecordChunksRef.current = []
        mr.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) callRecordChunksRef.current.push(e.data)
        }
        mr.onstop = () => {
          const blob = new Blob(callRecordChunksRef.current, { type: mr.mimeType || 'audio/webm' })
          const convId = activeConversationIdRef.current
          if (convId) {
            audioByConversationRef.current.set(convId, blob)
            setAudioAvailableTick((x) => x + 1)
            pushLine('system', `Audio saqlandi: ${(blob.size / 1024).toFixed(0)} KB.`)
          }
        }
        mr.start(1000)
      } catch {
        // ignore (MediaRecorder may be unavailable)
      }

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      // Lower latency improves responsiveness for streaming STT
      const ctx = new AudioCtx({ latencyHint: 'interactive' })
      audioCtxRef.current = ctx
      try {
        await ctx.resume()
      } catch {
        // ignore
      }
      const source = ctx.createMediaStreamSource(stream)
      sourceRef.current = source

      const sink = ctx.createGain()
      sink.gain.value = 0

      const proc = ctx.createScriptProcessor(4096, 1, 1)
      procRef.current = proc
      proc.onaudioprocess = (e) => {
        if (!sttActiveRef.current) return
        if (sttPausedRef.current) return
        const socket = sttWsRef.current
        if (!socket || socket.readyState !== WebSocket.OPEN) return
        const input = e.inputBuffer.getChannelData(0)
        // debug: rms + frames
        let sum = 0
        for (let i = 0; i < input.length; i++) sum += input[i] * input[i]
        const rms = Math.sqrt(sum / Math.max(1, input.length))
        if (Math.random() < 0.1) setSttDebug((d) => ({ frames: d.frames + 1, level: rms }))
        const pcm16 = downsampleTo16k(input, ctx.sampleRate)
        const ab = pcm16.buffer.slice(pcm16.byteOffset, pcm16.byteOffset + pcm16.byteLength) as ArrayBuffer
        socket.send(ab)
        sttLastPcmSentAtRef.current = Date.now()
      }
      source.connect(proc)
      proc.connect(sink)
      sink.connect(ctx.destination)

      // Keep-alive: Google streaming STT requires near real-time audio.
      // When operator pauses STT (or browser throttles audio), send short silence frames to avoid timeout.
      if (sttKeepAliveTimerRef.current) {
        window.clearInterval(sttKeepAliveTimerRef.current)
        sttKeepAliveTimerRef.current = null
      }
      sttKeepAliveTimerRef.current = window.setInterval(() => {
        try {
          if (!sttActiveRef.current) return
          const socket = sttWsRef.current
          if (!socket || socket.readyState !== WebSocket.OPEN) return
          const idleMs = Date.now() - (sttLastPcmSentAtRef.current || 0)
          if (idleMs < 1200) return
          const silence = new Int16Array(1600) // 100ms @ 16kHz
          const ab = silence.buffer.slice(silence.byteOffset, silence.byteOffset + silence.byteLength) as ArrayBuffer
          socket.send(ab)
          sttLastPcmSentAtRef.current = Date.now()
        } catch {
          // ignore
        }
      }, 700)

      pushLine('system', 'Call connected → Google STT streaming ON (low-latency).')
    } catch (e) {
      setSttState('error')
      setSttError(String(e))
      pushLine('system', `STT error: ${String(e)}`)
      sttActiveRef.current = false
    }
  }

  function stopSttStream() {
    sttActiveRef.current = false
    if (sttKeepAliveTimerRef.current) {
      try {
        window.clearInterval(sttKeepAliveTimerRef.current)
      } catch {}
      sttKeepAliveTimerRef.current = null
    }
    try {
      procRef.current?.disconnect()
    } catch {}
    try {
      sourceRef.current?.disconnect()
    } catch {}
    procRef.current = null
    sourceRef.current = null
    try {
      audioCtxRef.current?.close()
    } catch {}
    audioCtxRef.current = null
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop())
    } catch {}
    streamRef.current = null
    try {
      callRecorderRef.current?.stop()
    } catch {}
    callRecorderRef.current = null
    try {
      sttWsRef.current?.close()
    } catch {}
    sttWsRef.current = null
    setSttBytesIn(0)
    setSttInterim('')
    setSttState('idle')
  }

  async function connectCall() {
    setCallState('connected')
    setSttPaused(false)
    // In real call-center: PBX event "call connected" would trigger STT.
    // In hackathon demo: we auto-start the mic capture + STT stream.
    await startSttStream()
  }

  function endCall() {
    setCallState('idle')
    setSttPaused(false)
    stopSttStream()
    pushLine('system', 'Qo‘ng‘iroq yakunlandi.')
  }

  function requestConsent() {
    if (consent !== 'notAsked') return
    setConsent('pending')
    pushLine('system', "Open Banking so'rovi jo'natildi (QR/SMS/push).")
    // Demo: 3 soniyada tasdiq yoki rad
    window.setTimeout(() => {
      const granted = Math.random() > 0.35
      setConsent(granted ? 'granted' : 'declined')
      pushLine('system', granted ? 'Consent: GRANTED. External signal olindi (derived).' : 'Consent: DECLINED. Fallback: ichki data bilan davom.')
      if (granted) {
        setAiDraftForActive({
          title: 'Operator uchun tayyor replika',
          text: 'Tushundim. Consent tasdiqlandi — tashqi signallar asosida mijozning umumiy yukini tez baholaymiz va SQB ichki talablariga mos eng xavfsiz limit/variantni tanlaymiz. Aniq limit va shartlarni tizimdan tekshirib, shaffof aytib beraman.',
          confidence: 0.84,
        })
      }
    }, 3000)
  }

  if (appView === 'sms') {
    return <SmsCampaign onBack={() => setAppView('copilot')} />
  }

  return (
    <div className="appShell" style={{ ['--sqb-mark' as any]: `url(${sqbMark})` }}>
      <header className="topBar">
        <div className="topBarLead">
          <div className="brand">
            <div className="brandMark" aria-hidden="true" />
            <div className="brandText">
              <div className="brandTitle">NAVI VoiceAI</div>
              <div className="brandSub">Cluely‑style whisper panel · CVM‑first · Open Banking consent</div>
            </div>
          </div>

          <button type="button" className="smsNavBtn" onClick={() => setAppView('sms')} title="SMS kampaniya (3 segment)">
            SMS CVM
          </button>
        </div>

        {activeConversation ? (
          <div
            className="customerPill"
            title={`Chat ID: ${activeConversation.id}\nMavzu: ${activeConversation.topic}\nBu suhbatda AI faqat shu mavzu bo‘yicha javob beradi.`}
          >
            <div className="pillRowPrimary">
              <div className="pillTitle">
                {activeConversation.customer.firstName} {activeConversation.customer.lastName}
              </div>
              <div className="pillTopic" aria-label="Suhbat mavzusi">
                <span className="pillTopicLabel">Mavzu</span>
                <span className="pillTopicValue">{activeConversation.topic}</span>
              </div>
            </div>
            <div className="pillChatId" title={activeConversation.id}>
              <span className="pillChatIdKey">Chat ID:</span>{' '}
              <span className="pillChatIdVal">{activeConversation.id}</span>
            </div>
            <div className="pillMeta">
              {activeConversation.customer.phone} · {activeConversation.customer.segment} ·{' '}
              {activeConversation.customer.language}
            </div>
          </div>
        ) : null}

        <div className="topBarActions">
          <div className="actionGroup" aria-label="Qo‘ng‘iroq va til">
            <button
              type="button"
              className={callState === 'connected' ? 'btn btnStop' : 'btn btnPrimary'}
              onClick={callState === 'connected' ? endCall : connectCall}
              title={callState === 'connected' ? 'Qo‘ng‘iroqni tugatish' : 'Qo‘ng‘iroqni ulash (demo)'}
            >
              <span className="btnIcon">{callState === 'connected' ? '⏹' : '☎'}</span>
              <span className="btnText">
                {callState === 'connected'
                  ? sttState === 'sending'
                    ? 'End (STT…)'
                    : 'End call'
                  : 'Connect'}
              </span>
            </button>

            <button
              type="button"
              className={sttPaused ? 'btn btnStop' : 'btn'}
              onClick={() => callState === 'connected' && setSttPaused((v) => !v)}
              disabled={callState !== 'connected'}
              title="Operator gapirganda yoqing (SPACE bosib turish ham ishlaydi)"
            >
              <span className="btnIcon">⏸</span>
              <span className="btnText">{sttPaused ? 'Paused' : 'Pause STT'}</span>
            </button>

            <div className="seg">
              <button
                type="button"
                className={sttLangMode === 'auto' ? 'segBtn segBtn_on' : 'segBtn'}
                onClick={() => setSttLangMode('auto')}
                title="Auto: o‘zbek/rus aralash gaplarni ham ushlaydi"
              >
                Auto
              </button>
              <button
                type="button"
                className={sttLangMode === 'uz' ? 'segBtn segBtn_on' : 'segBtn'}
                onClick={() => setSttLangMode('uz')}
                title="Faqat o‘zbekcha"
              >
                UZ
              </button>
              <button
                type="button"
                className={sttLangMode === 'ru' ? 'segBtn segBtn_on' : 'segBtn'}
                onClick={() => setSttLangMode('ru')}
                title="Faqat ruscha"
              >
                RU
              </button>
            </div>
          </div>

          <div className="actionDivider" aria-hidden="true" />

          <div className="actionGroup actionGroup--tail" aria-label="Consent, STT, eksport">
            <button type="button" className="btn btnSmall" onClick={requestConsent} disabled={consent !== 'notAsked'} title="Open Banking consent">
              <span className="btnIcon">🔐</span>
              <span className="btnText">{consent === 'notAsked' ? 'Consent' : "Jo'natildi"}</span>
            </button>

            <div className="toolStat" title="STT debug">
              STT: {sttDebug.frames} · {sttDebug.level.toFixed(3)} · {sttBytesIn}
            </div>

            <button
              type="button"
              className="btn btnSmall dlBtn"
              onClick={() => downloadActiveChat('txt')}
              disabled={!activeConversation}
              title="Download chat (TXT)"
            >
              <span className="btnIcon">⬇</span>
              <span className="dlLabel">TXT</span>
            </button>
            <button
              type="button"
              className="btn btnSmall dlBtn"
              onClick={() => downloadActiveChat('json')}
              disabled={!activeConversation}
              title="Download chat (JSON)"
            >
              <span className="btnIcon">⬇</span>
              <span className="dlLabel">JSON</span>
            </button>
            <button
              type="button"
              className="btn btnSmall dlBtn"
              onClick={downloadActiveAudio}
              disabled={!activeConversation || !audioByConversationRef.current.get(activeConversationIdRef.current)}
              title="Download audio (WEBM)"
            >
              <span className="btnIcon">⬇</span>
              <span className="dlLabel">AUDIO</span>
            </button>
          </div>
        </div>
      </header>

      <main className="grid gridChat">
        <aside className="panel panelLeft">
          {leftMode === 'list' ? (
            <>
              <div className="panelHeader">
                <div className="panelTitle">Mijozlar</div>
                <div className="panelHeaderRight">
                  <div className="panelMeta">{filteredConversations.length}</div>
                  <button type="button" className="btn btnSmall" onClick={() => setAddOpen(true)} title="Mijoz qo‘shish">
                    + Add
                  </button>
                </div>
              </div>

              <div className="peopleSearch">
                <input
                  className="searchInput"
                  placeholder="Qidirish: tel / ism / pasport"
                  value={peopleFilter}
                  onChange={(e) => setPeopleFilter(e.target.value)}
                />
              </div>

              <div className="peopleList" ref={peopleListRef}>
                {filteredConversations.map((c) => {
                  const isActive = c.id === activeConversationId
                  return (
                    <div key={c.id} className={`tgRow ${isActive ? 'active' : ''}`}>
                      <button
                        type="button"
                        className="tgAvatar"
                        title="Profilni ochish"
                        onClick={() => {
                          setProfileOpenId(c.id)
                          setLeftMode('profile')
                        }}
                      >
                        {c.customer.firstName[0]?.toUpperCase()}
                        {c.customer.lastName[0]?.toUpperCase()}
                      </button>
                      <button
                        type="button"
                        className="tgMain"
                        onClick={() => setActiveConversationId(c.id)}
                        title="Chatni ochish"
                      >
                        <div className="tgTop">
                          <div className="tgName">
                            {c.customer.firstName} {c.customer.lastName}
                          </div>
                          <div className="tgTime">
                            {new Date(c.lastUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                        <div className="tgTopic">{c.topic}</div>
                        <div className="tgBottom">
                          <div className="tgMeta mono">{c.customer.phone}</div>
                        </div>
                      </button>
                      <button
                        type="button"
                        className="tgDel"
                        title="Chatni o‘chirish"
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteConversation(c.id)
                        }}
                      >
                        🗑
                      </button>
                    </div>
                  )
                })}
              </div>

              {addOpen ? (
                <div className="modalOverlay" onClick={() => setAddOpen(false)}>
                  <div className="modalSheet" onClick={(e) => e.stopPropagation()}>
                    <div className="modalHeader">
                      <div className="modalTitle">Mijoz qo‘shish</div>
                      <button type="button" className="btn btnSmall" onClick={() => setAddOpen(false)}>
                        Yopish
                      </button>
                    </div>
                    <div className="modalBody">
                      <div className="kv">
                        <div className="k">Pasport (seriya/raqam)</div>
                        <input
                          className="searchInput"
                          placeholder="Masalan: AA1234567"
                          value={addPassport}
                          onChange={(e) => setAddPassport(e.target.value)}
                        />
                      </div>

                      {addPreview ? (
                        <div className="addPreview">
                          <div className="pillTitle">
                            {addPreview.profile.firstName} {addPreview.profile.lastName}{' '}
                            {addPreview.kind === 'existing' ? '(bor)' : '(yangi)'}
                          </div>
                          <div className="pillMeta mono">
                            {addPreview.profile.phone} · {addPreview.profile.segment} · {addPreview.profile.language}
                          </div>
                          <div className="pillMeta">Mavzu: {addPreview.topic}</div>
                        </div>
                      ) : (
                        <div className="footNote">Pasport kiriting — qolgan ma’lumotlar avtomatik chiqadi.</div>
                      )}
                    </div>
                    <div className="modalFooter">
                      <button type="button" className="btn btnPrimary" onClick={confirmAddCustomer} disabled={!addPreview}>
                        {addPreview?.kind === 'existing' ? 'Ochish' : 'Qo‘shish'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="leftProfile">
              <div className="leftProfileHeader">
                <button
                  type="button"
                  className="backBtn"
                  onClick={() => {
                    setLeftMode('list')
                    setProfileOpenId(null)
                  }}
                >
                  ← Orqaga
                </button>
                <div className="leftProfileTitle">Profil</div>
              </div>

              {profileConversation ? (
                <div className="profile" style={{ ['--sqb-mark' as any]: `url(${sqbMark})` }}>
                  <div className="profileName">
                    {profileConversation.customer.firstName} {profileConversation.customer.lastName}
                  </div>
                  <div className="profileGrid">
                    <div className="kv">
                      <div className="k">Telefon</div>
                      <div className="v mono">{profileConversation.customer.phone}</div>
                    </div>
                    <div className="kv">
                      <div className="k">Pasport</div>
                      <div className="v mono">{profileConversation.customer.passport}</div>
                    </div>
                    <div className="kv">
                      <div className="k">Tug‘ilgan sana</div>
                      <div className="v mono">{profileConversation.customer.birthDate}</div>
                    </div>
                    <div className="kv">
                      <div className="k">Segment</div>
                      <div className="v">{profileConversation.customer.segment}</div>
                    </div>
                    <div className="kv">
                      <div className="k">Mavzu</div>
                      <div className="v">{profileConversation.topic}</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="profile" style={{ ['--sqb-mark' as any]: `url(${sqbMark})` }}>
                  <div className="footNote">Profil topilmadi.</div>
                </div>
              )}
            </div>
          )}
        </aside>

        <section className="panel panelCenter">
          <div className="panelHeader">
            <div className="panelTitle">Chat + AI (operator panel)</div>
            <div className="panelMeta">mijoz gaplari + AI javob taklifi</div>
          </div>

          <div className="chatWrap">
            <div
              className="chatStream"
              ref={chatStreamRef}
              style={{ ['--chat-watermark' as any]: `url(${sqbWatermark})` }}
            >
              {activeConversation ? (
                <div className="topicBanner" role="status">
                  <span className="topicBannerStrong">Hozirgi suhbat:</span>{' '}
                  <span className="mono topicBannerId">{activeConversation.id}</span>
                  <span className="topicBannerSep">·</span>
                  <span className="topicBannerTopic">faqat «{activeConversation.topic}» mavzusida</span>
                </div>
              ) : null}
              {sttError ? (
                <div className="sysPill">{sttError}</div>
              ) : null}
              {(activeConversation?.transcript ?? []).map((l) => {
                if (l.speaker === 'system') {
                  return (
                    <div key={l.id} className="sysPill">
                      {l.text}
                    </div>
                  )
                }

                const side = l.speaker === 'agent' ? 'right' : 'left'
                const ticks = l.speaker === 'agent' ? '✓✓' : ''
                return (
                  <div key={l.id} className={`msgRow msgRow_${side}`}>
                    <div className={`msgBubble msgBubble_${l.speaker}`}>
                      <div className="msgText">{l.text}</div>
                      <div className="msgMeta">
                        <span className="msgTime">{l.t}</span>
                        {ticks ? <span className="msgTicks">{ticks}</span> : null}
                      </div>
                    </div>
                  </div>
                )
              })}
              {interimRef.current ? (
                <div className="msgRow msgRow_left" style={{ opacity: 0.7 }}>
                  <div className="msgBubble msgBubble_customer">
                    <div className="msgText">{sttInterim || interimRef.current}</div>
                  </div>
                </div>
              ) : null}
              <div ref={chatBottomRef} />
            </div>

            <div className="aiDock" ref={aiDockRef}>
              {nextBestAction.text.trim() ? (
                <div className="card">
                  <div className="cardTop">
                    <div className="cardTitle">{nextBestAction.title}</div>
                    <div className="chip">conf: {Math.round(nextBestAction.confidence * 100)}%</div>
                  </div>
                  <div className="cardBody">{nextBestAction.text}</div>
                  <div className="cardActions">
                    <button type="button" className="btn btnSmall" onClick={() => pushLine('agent', nextBestAction.text)}>
                      Insert as reply
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {/* Post-call summary removed for hackathon MVP */}
        </section>
      </main>

      {/* profile moved into left panel */}
    </div>
  )
}

export default App
