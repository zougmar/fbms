import { useEffect, useMemo, useState } from 'react';
import { MessageCircle, MessageSquare, Phone } from 'lucide-react';
import api from '../services/api';
import { useApp } from '../context';
import { money } from '../utils';
import { Modal } from './ui';

const TEMPLATES = [
  ['confirm', 'Confirmation', 'تأكيد'],
  ['confirmed', 'Commande confirmée', 'طلب مؤكد'],
  ['preparing', 'Préparation', 'التحضير'],
  ['shipped', 'Expédition', 'الشحن'],
  ['delivered', 'Livraison', 'التسليم'],
  ['return', 'Retour', 'إرجاع'],
  ['cancelled', 'Annulation', 'إلغاء']
];

const BY_STATUS = {
  'À confirmer': 'confirm',
  'Confirmée': 'confirmed',
  'En préparation': 'preparing',
  'Expédiée': 'shipped',
  'Livrée': 'delivered',
  'Retour': 'return',
  'Annulée': 'cancelled'
};

export function toInternational(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0') && digits.length === 10) digits = `212${digits.slice(1)}`;
  else if (digits.length === 9 && /^[5-8]/.test(digits)) digits = `212${digits}`;
  if (!/^212[5-8]\d{8}$/.test(digits)) return '';
  return digits;
}

export function formatInternational(digits) {
  const local = digits.slice(3);
  return `+212 ${local[0]} ${local.slice(1, 3)} ${local.slice(3, 5)} ${local.slice(5, 7)} ${local.slice(7)}`;
}

function messageFor(id, lang, fields) {
  const tracking = fields.tracking
    ? (lang === 'ar' ? `رقم التتبع: ${fields.tracking}.` : `Numéro de suivi : ${fields.tracking}.`)
    : '';
  const line = fields.line
    ? (lang === 'ar' ? `للتواصل معنا: ${fields.line}` : `Pour nous joindre : ${fields.line}`)
    : '';
  const fr = {
    confirm: `Bonjour ${fields.name},\nIci ${fields.company}. Nous avons reçu votre commande ${fields.order} : ${fields.product}.\nMontant : ${fields.total}.\nLivraison à ${fields.city}, ${fields.address}.\nMerci de confirmer pour lancer la préparation.`,
    confirmed: `Bonjour ${fields.name},\nVotre commande ${fields.order} (${fields.product}) est confirmée.\nMontant : ${fields.total}.\nNous préparons l'envoi vers ${fields.city}.\n${fields.company}`,
    preparing: `Bonjour ${fields.name},\nVotre commande ${fields.order} est en préparation.\nNous vous écrivons dès l'expédition vers ${fields.city}.\n${fields.company}`,
    shipped: `Bonjour ${fields.name},\nVotre commande ${fields.order} est expédiée vers ${fields.city}.\n${tracking}\nMerci de rester joignable pour la livraison.\n${fields.company}`,
    delivered: `Bonjour ${fields.name},\nVotre commande ${fields.order} est livrée. Merci pour votre confiance.\n${fields.company}`,
    return: `Bonjour ${fields.name},\nLe colis de la commande ${fields.order} est en retour.\nDites-nous si vous souhaitez une nouvelle livraison.\n${fields.company}`,
    cancelled: `Bonjour ${fields.name},\nVotre commande ${fields.order} est annulée.\nRépondez à ce message si cette annulation n'est pas la vôtre.\n${fields.company}`
  };
  const ar = {
    confirm: `مرحبا ${fields.name}،\nمعكم ${fields.company}. توصلنا بطلبكم ${fields.order}: ${fields.product}.\nالمبلغ: ${fields.total}.\nالتوصيل إلى ${fields.city}، ${fields.address}.\nالمرجو تأكيد الرسالة لنبدأ التحضير.`,
    confirmed: `مرحبا ${fields.name}،\nطلبكم ${fields.order} (${fields.product}) مؤكد.\nالمبلغ: ${fields.total}.\nنحن نحضر الإرسال إلى ${fields.city}.\n${fields.company}`,
    preparing: `مرحبا ${fields.name}،\nطلبكم ${fields.order} قيد التحضير.\nسنخبركم عند الشحن إلى ${fields.city}.\n${fields.company}`,
    shipped: `مرحبا ${fields.name}،\nطلبكم ${fields.order} في الطريق إلى ${fields.city}.\n${tracking}\nالمرجو البقاء قريبا من الهاتف عند التسليم.\n${fields.company}`,
    delivered: `مرحبا ${fields.name}،\nتم تسليم طلبكم ${fields.order}. شكرا لثقتكم.\n${fields.company}`,
    return: `مرحبا ${fields.name}،\nطرد الطلب ${fields.order} في طريق الإرجاع.\nأخبرونا إذا أردتم إعادة التوصيل.\n${fields.company}`,
    cancelled: `مرحبا ${fields.name}،\nتم إلغاء طلبكم ${fields.order}.\nإذا لم تطلبوا الإلغاء، ردوا على هذه الرسالة.\n${fields.company}`
  };
  return [(lang === 'ar' ? ar : fr)[id] || '', line].filter(Boolean).join('\n');
}

function Composer({ customer, onDone }) {
  const { tx, lang, notify } = useApp();
  const [company, setCompany] = useState('FBMS');
  const [companyPhone, setCompanyPhone] = useState('');
  const [channel, setChannel] = useState('whatsapp');
  const [messageLang, setMessageLang] = useState(lang === 'ar' ? 'ar' : 'fr');
  const [template, setTemplate] = useState(BY_STATUS[customer.status] || 'confirm');
  const [draft, setDraft] = useState('');
  const digits = toInternational(customer.phone);

  useEffect(() => {
    api.get('/settings').then((res) => {
      if (res.data.item?.companyName) setCompany(res.data.item.companyName);
      if (res.data.item?.phone) setCompanyPhone(res.data.item.phone);
    }).catch(() => {});
  }, []);

  const fields = useMemo(() => ({
    name: customer.name || '',
    company,
    order: customer.orderNumber || '',
    product: `${customer.productName || ''}${customer.quantity ? ` × ${customer.quantity}` : ''}`,
    total: money(customer.totalAmount),
    city: customer.cityName || '',
    address: customer.address || '',
    tracking: customer.trackingNumber || '',
    line: companyPhone
  }), [customer, company, companyPhone]);

  useEffect(() => {
    setDraft(messageFor(template, messageLang, fields).replace(/\n{3,}/g, '\n\n').trim());
  }, [template, messageLang, fields]);

  const copyText = async (text, okMessage) => {
    try {
      await navigator.clipboard.writeText(text);
      notify.success({ title: tx('Copié', 'تم النسخ'), message: okMessage });
    } catch {
      notify.error({
        title: tx('Copie impossible', 'تعذر النسخ'),
        message: tx('Sélectionnez le texte et copiez-le manuellement.', 'حدد النص وانسخه يدويا.')
      });
    }
  };

  const openChannel = () => {
    if (!digits) {
      notify.error({
        title: tx('Numéro inutilisable', 'رقم غير صالح'),
        message: tx('Convertissez le numéro au format 06… ou +212… avant de contacter le client.', 'حوّل الرقم إلى صيغة 06… أو +212… قبل الاتصال.')
      });
      return;
    }
    if (channel === 'call') {
      window.location.href = `tel:+${digits}`;
      notify.info({
        title: tx('Appel', 'اتصال'),
        message: tx('Le numéro est prêt sur votre téléphone.', 'الرقم جاهز على هاتفك.')
      });
      return;
    }
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const url = channel === 'sms'
      ? `sms:+${digits}${ios ? '&' : '?'}body=${encodeURIComponent(draft)}`
      : `https://wa.me/${digits}?text=${encodeURIComponent(draft)}`;
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) {
      notify.warning({
        title: tx('Fenêtre bloquée', 'تم حظر النافذة'),
        message: tx('Autorisez les fenêtres, ou copiez le message.', 'اسمح بالنوافذ، أو انسخ الرسالة.')
      });
      return;
    }
    notify.info({
      title: channel === 'sms' ? tx('SMS prêt', 'الرسالة جاهزة') : tx('WhatsApp prêt', 'واتساب جاهز'),
      message: tx('Relisez le texte, puis envoyez-le depuis l’application.', 'راجع النص ثم أرسله من التطبيق.')
    });
    onDone?.();
  };

  const channels = [
    ['call', tx('Appeler', 'اتصال'), Phone, ''],
    ['sms', tx('SMS', 'رسالة'), MessageSquare, ''],
    ['whatsapp', 'WhatsApp', MessageCircle, 'whatsapp']
  ];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-extrabold">{customer.name || tx('Client', 'الزبون')}</div>
          <div className="text-sm" dir="ltr" style={{ color: 'var(--muted)' }}>{digits ? formatInternational(digits) : customer.phone}</div>
        </div>
        <div className="grid justify-items-end gap-1">
          {customer.orderNumber && <span className="badge">{customer.orderNumber}</span>}
          {companyPhone && <span className="text-xs" dir="ltr" style={{ color: 'var(--muted)' }}>{tx('Votre ligne', 'خطك')} {companyPhone}</span>}
        </div>
      </div>
      {!digits && (
        <p className="text-sm" style={{ color: 'var(--danger)' }}>
          {tx('Ce numéro n’est pas un mobile marocain exploitable.', 'هذا الرقم ليس هاتفا مغربيا صالحا.')}
        </p>
      )}
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={tx('Canal', 'القناة')}>
        {channels.map(([id, label, Icon, extra]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={channel === id}
            className={`channel ${extra} ${channel === id ? 'active' : ''}`}
            onClick={() => setChannel(id)}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`chip ${messageLang === 'fr' ? 'active' : ''}`} onClick={() => setMessageLang('fr')}>Français</button>
        <button type="button" className={`chip ${messageLang === 'ar' ? 'active' : ''}`} onClick={() => setMessageLang('ar')}>العربية</button>
      </div>
      <div className="flex flex-wrap gap-2">
        {TEMPLATES.map(([id, fr, ar]) => (
          <button key={id} type="button" className={`chip ${template === id ? 'active' : ''}`} onClick={() => setTemplate(id)}>{tx(fr, ar)}</button>
        ))}
      </div>
      <label className="block">
        <span className="label">{channel === 'call' ? tx('Mémo d’appel', 'مذكرة الاتصال') : tx('Message', 'الرسالة')}</span>
        <textarea className="area" dir={messageLang === 'ar' ? 'rtl' : 'ltr'} rows={7} value={draft} onChange={(event) => setDraft(event.target.value)} />
      </label>
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        {tx('FBMS n’envoie rien tout seul. Vous validez l’envoi dans Téléphone, SMS ou WhatsApp.', 'FBMS لا يرسل شيئا بنفسه. أنت تؤكد الإرسال من الهاتف أو الرسائل أو واتساب.')}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="btn btn-ghost" onClick={() => copyText(digits ? `+${digits}` : customer.phone, tx('Le numéro est copié.', 'تم نسخ الرقم.'))}>{tx('Copier le numéro', 'نسخ الرقم')}</button>
        <button type="button" className="btn btn-ghost" onClick={() => copyText(draft, tx('Le message est copié.', 'تم نسخ الرسالة.'))}>{tx('Copier le message', 'نسخ الرسالة')}</button>
        <button type="button" className={`btn ${channel === 'whatsapp' ? 'btn-whatsapp' : 'btn-primary'}`} disabled={!digits || (channel !== 'call' && !draft.trim())} onClick={openChannel}>
          {channel === 'call' ? tx('Appeler', 'اتصال') : channel === 'sms' ? tx('Ouvrir le SMS', 'فتح الرسالة') : tx('Ouvrir WhatsApp', 'فتح واتساب')}
        </button>
      </div>
    </div>
  );
}

export default function CustomerContact({ customer, variant = 'button' }) {
  const { tx } = useApp();
  const [open, setOpen] = useState(false);
  if (!customer?.phone) return null;
  if (variant === 'panel') {
    return (
      <section className="card p-5">
        <h2 className="mb-4 text-lg font-extrabold">{tx('Contacter le client', 'التواصل مع الزبون')}</h2>
        <Composer customer={customer} />
      </section>
    );
  }
  return (
    <>
      <button type="button" className="contact-trigger" onClick={() => setOpen(true)}>
        <Phone size={12} aria-hidden="true" />
        <span dir="ltr">{customer.phone}</span>
      </button>
      {open && (
        <Modal title={tx('Contacter le client', 'التواصل مع الزبون')} onClose={() => setOpen(false)}>
          <Composer customer={customer} onDone={() => setOpen(false)} />
        </Modal>
      )}
    </>
  );
}
