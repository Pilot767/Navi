import { useEffect, useMemo, useState } from 'react'
import './SmsCampaign.css'

type TierId = 'weak' | 'mid' | 'strong'

type DemoCustomer = {
  id: string
  name: string
  phone: string
  hint: string
}

type SmsOffer = {
  id: string
  title: string
  badge: string
  defaultText: string
}

const TIERS: {
  id: TierId
  title: string
  subtitle: string
  accent: string
  customers: DemoCustomer[]
  offers: SmsOffer[]
}[] = [
  {
    id: 'weak',
    title: 'Yomon segment',
    subtitle: 'Churn / DPD / pastki skor',
    accent: 'tier_weak',
    customers: [
      { id: 'w1', name: 'Dilshod E.', phone: '+998 93 *** 04 40', hint: 'DPD signal' },
      { id: 'w2', name: 'Nodir K.', phone: '+998 90 *** 11 22', hint: 'Past aylanma' },
      { id: 'w3', name: 'Gulnora S.', phone: '+998 91 *** 88 77', hint: 'Kartada blok' },
    ],
    offers: [
      {
        id: 'w-a',
        title: 'Soft touch',
        badge: 'Qo‘llab-quvvatlash',
        defaultText:
          "Hurmatli mijoz, to‘lovlaringiz bo‘yicha yengillashtirilgan rejani ko‘rib chiqish uchun SQB Call-center 24/7. Shaxsiy yechim — bir qo‘ng‘iroqda.",
      },
      {
        id: 'w-b',
        title: 'Restrukturizatsiya',
        badge: 'Kredit',
        defaultText:
          'SQB: majburiyatingizni boshqarish uchun restrukturizatsiya yoki refinans imkoniyatini CVM orqali taklif qilamiz. Javob uchun “HA” deb yuboring.',
      },
      {
        id: 'w-c',
        title: 'Xavfsiz kanal',
        badge: 'Eslatma',
        defaultText:
          "SQB: kechikkan to‘lov bo‘yicha penya va reytingga ta’sir haqida qisqacha eslatma. Yordam uchun ilovaga kiring yoki qo‘ng‘iroq qiling — komissiyasiz yo‘naltiramiz.",
      },
    ],
  },
  {
    id: 'mid',
    title: 'O‘rta segment',
    subtitle: 'Mass / barqaror',
    accent: 'tier_mid',
    customers: [
      { id: 'm1', name: 'Malika T.', phone: '+998 90 *** 02 20', hint: 'O‘rtacha skor' },
      { id: 'm2', name: 'Sardor I.', phone: '+998 97 *** 01 10', hint: '1 ta kredit' },
      { id: 'm3', name: 'Madina R.', phone: '+998 90 *** 09 90', hint: 'Keshbek qiziqishi' },
      { id: 'm4', name: 'Otabek M.', phone: '+998 99 *** 08 80', hint: 'Valyuta+' },
    ],
    offers: [
      {
        id: 'm-a',
        title: 'Kross-sell',
        badge: 'Karta + depozit',
        defaultText:
          'SQB: kundalik kartangiz bilan mos depozit yoki keshbek kartani 0 so‘mdan rasmiylashtirish imkoniyati. Batafsil: sqb.uz — “Mening taklifim” kodini ayting.',
      },
      {
        id: 'm-b',
        title: 'Loyalty',
        badge: 'Bonus',
        defaultText:
          "SQB Mobile'da 3 ta avtoto‘lovni ulang — oyiga 50 000 so‘mgacha keshbek (aksiya shartlariga muvofiq). Hozir ulash uchun ilovaga kiring.",
      },
      {
        id: 'm-c',
        title: 'Mikro yordam',
        badge: 'Mikro',
        defaultText:
          'SQB: tasdiqlangan mijozlar uchun onlayn mikroqarz — qaror 2 daqiqada (skoringga bog‘liq). “MIKRO” deb SMS qaytaring, havola yuboramiz.',
      },
    ],
  },
  {
    id: 'strong',
    title: 'A’lo segment',
    subtitle: 'Affluent / yuqori LTV',
    accent: 'tier_strong',
    customers: [
      { id: 's1', name: 'Aziza K.', phone: '+998 90 *** 45 67', hint: 'Premium potensial' },
      { id: 's2', name: 'Timur P.', phone: '+998 98 *** 06 60', hint: 'Katta aylanma' },
      { id: 's3', name: 'Rustam Q.', phone: '+998 91 *** 03 30', hint: 'SME+' },
    ],
    offers: [
      {
        id: 's-a',
        title: 'Premium invite',
        badge: 'VIP',
        defaultText:
          'SQB Premium: shaxsiy menejer, valyuta ustuvorligi va sayohat sug‘urtasi paketi. Taklifni tasdiqlash uchun “PREMIUM” deb javob bering.',
      },
      {
        id: 's-b',
        title: 'Wealth',
        badge: 'Invest + depozit',
        defaultText:
          'SQB: multi-valyuta depozit va muddatli strategiya bo‘yicha qisqa brif — faqat taklif qilingan mijozlar uchun. Uchrashuv vaqtini tanlang: hafta 10:00–18:00.',
      },
      {
        id: 's-c',
        title: 'Private tariff',
        badge: 'Tarif',
        defaultText:
          'SQB: sizning aylanmangiz uchun maxsus tarif paketi (komissiya va valyuta spread bo‘yicha). Batafsil shartlar — faqat shaxsiy kanal orqali, spam emas.',
      },
    ],
  },
]

type Props = {
  onBack: () => void
}

export default function SmsCampaign({ onBack }: Props) {
  useEffect(() => {
    const root = document.getElementById('root')
    document.documentElement.classList.add('app-sms-page')
    document.body.classList.add('app-sms-page')
    root?.classList.add('app-sms-page')
    return () => {
      document.documentElement.classList.remove('app-sms-page')
      document.body.classList.remove('app-sms-page')
      root?.classList.remove('app-sms-page')
    }
  }, [])

  const [textByKey, setTextByKey] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const t of TIERS) {
      for (const o of t.offers) {
        init[`${t.id}:${o.id}`] = o.defaultText
      }
    }
    return init
  })
  const [toast, setToast] = useState<string | null>(null)

  const allCustomerIds = useMemo(() => TIERS.flatMap((t) => t.customers.map((c) => c.id)), [])

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(allCustomerIds))

  const totalReach = useMemo(() => TIERS.reduce((n, t) => n + t.customers.length, 0), [])
  const selectedCount = selectedIds.size

  function toggleCustomer(id: string) {
    setSelectedIds((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  function selectAllInTier(tier: (typeof TIERS)[number]) {
    setSelectedIds((prev) => {
      const n = new Set(prev)
      tier.customers.forEach((c) => n.add(c.id))
      return n
    })
  }

  function clearTier(tier: (typeof TIERS)[number]) {
    setSelectedIds((prev) => {
      const n = new Set(prev)
      tier.customers.forEach((c) => n.delete(c.id))
      return n
    })
  }

  function selectEveryone() {
    setSelectedIds(new Set(allCustomerIds))
  }

  function clearEveryone() {
    setSelectedIds(new Set())
  }

  function setOfferText(tierId: TierId, offerId: string, text: string) {
    setTextByKey((prev) => ({ ...prev, [`${tierId}:${offerId}`]: text }))
  }

  function tierSelected(tier: (typeof TIERS)[number]) {
    return tier.customers.filter((c) => selectedIds.has(c.id))
  }

  function sendOffer(tier: (typeof TIERS)[number], offer: SmsOffer) {
    const picked = tierSelected(tier)
    if (picked.length === 0) {
      setToast(`${tier.title}: kamida bitta mijozni tanlang.`)
      window.setTimeout(() => setToast(null), 3200)
      return
    }
    const body = (textByKey[`${tier.id}:${offer.id}`] ?? offer.defaultText).trim()
    setToast(`${tier.title}: «${offer.title}» — ${picked.length} ta tanlangan mijozga SMS (demo).`)
    window.setTimeout(() => setToast(null), 4200)
    if (import.meta.env.DEV) {
      console.info('[SMS demo]', { tier: tier.id, offer: offer.id, recipients: picked.map((c) => c.phone), body })
    }
  }

  return (
    <div className="smsPage">
      <div className="smsBg" aria-hidden="true" />
      <header className="smsHeader">
        <div className="smsHeaderLeft">
          <button type="button" className="smsBack" onClick={onBack}>
            ← Copilot
          </button>
          <div>
            <h1 className="smsTitle">CVM · SMS kampaniya</h1>
            <p className="smsSub">3 ta segment · har biriga 3 ta taklif · mijozlarni tanlang yoki barchasini bir tugmada (demo)</p>
          </div>
        </div>
        <div className="smsHeaderRight">
          <div className="smsBulkBar" role="group" aria-label="Tanlov">
            <button type="button" className="smsBulkBtn smsBulkBtn_primary" onClick={selectEveryone}>
              Hammasini tanlash
            </button>
            <button type="button" className="smsBulkBtn" onClick={clearEveryone}>
              Hammasini bekor
            </button>
          </div>
          <div className="smsHeaderStat">
            <span className="smsStatN">
              {selectedCount}/{totalReach}
            </span>
            <span className="smsStatL">tanlangan</span>
          </div>
        </div>
      </header>

      {toast ? (
        <div className="smsToast" role="status">
          {toast}
        </div>
      ) : null}

      <div className="smsGrid">
        {TIERS.map((tier) => (
          <section key={tier.id} className={`smsColumn ${tier.accent}`}>
            <div className="smsColumnGlow" aria-hidden="true" />
            <header className="smsColumnHead">
              <div className="smsColumnBadge">{tier.title}</div>
              <h2 className="smsColumnTitle">{tier.subtitle}</h2>
              <p className="smsColumnMeta">
                {tier.customers.length} ta mijoz · tanlangan: {tierSelected(tier).length} · 3 ta taklif
              </p>
            </header>

            <div className="smsCustomers">
              <div className="smsCustomersToolbar">
                <div className="smsCustomersLabel">Mijozlar</div>
                <div className="smsTierPickBtns">
                  <button type="button" className="smsPickBtn" onClick={() => selectAllInTier(tier)}>
                    Barchasini tanlash
                  </button>
                  <button type="button" className="smsPickBtn smsPickBtn_muted" onClick={() => clearTier(tier)}>
                    Tozalash
                  </button>
                </div>
              </div>
              <ul className="smsCustomerList">
                {tier.customers.map((c) => {
                  const on = selectedIds.has(c.id)
                  return (
                    <li key={c.id}>
                      <label className={`smsCustomer smsCustomer_selectable ${on ? 'smsCustomer_on' : ''}`}>
                        <input
                          type="checkbox"
                          className="smsCustomerCb"
                          checked={on}
                          onChange={() => toggleCustomer(c.id)}
                        />
                        <div className="smsCustomerAv">{c.name.slice(0, 2).toUpperCase()}</div>
                        <div className="smsCustomerBody">
                          <div className="smsCustomerName">{c.name}</div>
                          <div className="smsCustomerPhone mono">{c.phone}</div>
                          <div className="smsCustomerHint">{c.hint}</div>
                        </div>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </div>

            <div className="smsOffers">
              <div className="smsOffersLabel">3 ta SMS taklifi</div>
              {tier.offers.map((offer, idx) => (
                <article key={offer.id} className="smsOfferCard">
                  <div className="smsOfferTop">
                    <span className="smsOfferIdx">{idx + 1}</span>
                    <div>
                      <h3 className="smsOfferTitle">{offer.title}</h3>
                      <span className="smsOfferBadge">{offer.badge}</span>
                    </div>
                  </div>
                  <label className="smsOfferLab" htmlFor={`sms-${tier.id}-${offer.id}`}>
                    Matn
                  </label>
                  <textarea
                    id={`sms-${tier.id}-${offer.id}`}
                    className="smsOfferText"
                    rows={4}
                    value={textByKey[`${tier.id}:${offer.id}`] ?? offer.defaultText}
                    onChange={(e) => setOfferText(tier.id, offer.id, e.target.value)}
                  />
                  <button
                    type="button"
                    className="smsSendBtn"
                    disabled={tierSelected(tier).length === 0}
                    onClick={() => sendOffer(tier, offer)}
                  >
                    Yuborish · {tierSelected(tier).length} ta
                  </button>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
