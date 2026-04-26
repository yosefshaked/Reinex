function normalizeMessage(error) {
  return String(error?.message || '').trim();
}

function formatAuthorizationLimitDetails(details) {
  if (!details || typeof details !== 'object') {
    return '';
  }
  const authorizedLessons = Number(details.authorized_lessons || 0);
  const alreadySelected = Number(details.already_selected_claims || 0);
  const attemptedClaims = Number(details.attempted_claims || 0);
  const parts = [];
  if (authorizedLessons > 0) {
    parts.push(`מכסה מאושרת: ${authorizedLessons}`);
  }
  if (alreadySelected > 0) {
    parts.push(`כבר שויכו לדרישות: ${alreadySelected}`);
  }
  if (attemptedClaims > 0) {
    parts.push(`ניסיתם להוסיף כעת: ${attemptedClaims}`);
  }
  return parts.join(' • ');
}

export function getHmoClaimFeedback(error, options = {}) {
  const code = normalizeMessage(error);
  const details = error?.data?.details || null;
  const scope = options.scope || 'claim';

  switch (code) {
    case 'hmo_claim_batch_empty':
      return {
        title: 'לא נמצאו שורות שאפשר לצרף לדרישה',
        description: 'רעננו את המסך, ודאו שהשיעורים סומנו כנוכחים ושהשורות עדיין מופיעות תחת תביעות HMO פתוחות. אם הן אמורות להיות זמינות ולא מופיעות, בדקו את השיעור, האישור והגורם המממן מול נתוני המערכת.',
      };
    case 'hmo_claim_line_not_claimable':
      return {
        title: 'חלק מהשורות שנבחרו כבר לא ניתנות לדרישה',
        description: 'רעננו את תביעות ה-HMO, בחרו מחדש רק שורות פעילות, וודאו שלא נבחרו שורות שכבר השתנו או טופלו. אם הבעיה חוזרת, בדקו את פרטי השיעור והאישור לפני ניסיון נוסף.',
      };
    case 'hmo_claim_provider_mismatch':
      return {
        title: 'נבחרו שורות של יותר מגורם מממן אחד',
        description: 'צרו דרישה נפרדת לכל גורם מממן. נקה את הבחירה הנוכחית ובחרו מחדש רק שורות של אותו גורם.',
      };
    case 'hmo_claim_line_already_batched_or_reversed':
      return {
        title: 'אחת השורות כבר טופלה או בוטלה',
        description: 'רעננו את המסך ובחרו שוב. אם צריך, פתחו את רשימת הדרישות הקיימות ובדקו אם השורה כבר שויכה לדרישה אחרת או עברה היפוך.',
      };
    case 'hmo_authorization_claim_limit_exceeded': {
      const limitDetails = formatAuthorizationLimitDetails(details);
      return {
        title: 'אי אפשר לדרוש יותר שיעורים מהמכסה המאושרת',
        description: `${limitDetails ? `${limitDetails}. ` : ''}בדקו את אישור ה-HMO של התלמיד וודאו שלא מנסים לצרף שיעור מעבר למכסה המאושרת. אם נדרש, עדכנו את האישור לפני יצירת הדרישה.`.trim(),
      };
    }
    case 'hmo_provider_inactive':
      return {
        title: 'הגורם המממן אינו פעיל',
        description: 'הפעילו מחדש את הגורם המממן או בחרו גורם מממן אחר לפני יצירת הדרישה.',
      };
    case 'invoice_batch_not_draft':
      return {
        title: 'אפשר לשלוח רק דרישה במצב טיוטה',
        description: 'רעננו את המסך ובדקו את סטטוס הדרישה. אם היא כבר נשלחה, עברו לרישום תשלום או לצפייה בלבד.',
      };
    case 'invoice_batch_empty':
      return {
        title: 'הדרישה ריקה',
        description: 'בחרו לפחות שורת תביעה פתוחה אחת לפני שליחת הדרישה.',
      };
    case 'invoice_batch_not_found':
      return {
        title: 'הדרישה לא נמצאה',
        description: 'רעננו את המסך ונסו שוב. אם הדרישה עדיין חסרה, ייתכן שהיא בוטלה או שונתה על ידי פעולה קודמת.',
      };
    case 'invoice_batch_not_submitted':
      return {
        title: scope === 'payment' ? 'אפשר לרשום תשלום רק לדרישה שנשלחה' : 'הדרישה עדיין לא נשלחה',
        description: scope === 'payment'
          ? 'שלחו קודם את הדרישה, ואז חזרו לרישום התשלום.'
          : 'שלחו את הדרישה לפני מעבר לשלב הבא.',
      };
    case 'paid_invoice_batch_cannot_be_cancelled':
      return {
        title: 'אי אפשר לבטל דרישה שכבר נרשם לה תשלום',
        description: 'בדקו אם צריך לבצע תיקון פיננסי נפרד במקום ביטול הדרישה.',
      };
    case 'hmo_payment_reference_required':
      return {
        title: 'חסרה אסמכתת תשלום',
        description: 'הזינו מספר אסמכתה או מזהה תשלום לפני שמירת התשלום.',
      };
    case 'hmo_payment_exceeds_batch_balance':
      return {
        title: 'סכום התשלום גבוה מהיתרה הפתוחה',
        description: 'בדקו את יתרת הדרישה והזינו רק את הסכום שנותר לשלם. אם התקבל תשלום גדול יותר, פצלו אותו בין כמה דרישות או בדקו התאמה ידנית.',
      };
    default:
      return {
        title: 'פעולת תביעת HMO נכשלה',
        description: error?.message
          ? `המערכת החזירה: ${error.message}. רעננו את המסך ובדקו את פרטי הדרישה, השיעור והאישור לפני ניסיון נוסף.`
          : 'רעננו את המסך ונסו שוב. אם התקלה חוזרת, בדקו את פרטי הדרישה, השיעור והאישור לפני ניסיון נוסף.',
      };
  }
}

export function getHmoClaimValidationFeedback(kind) {
  switch (kind) {
    case 'no_selection':
      return {
        title: 'לא נבחרו שורות לדרישה',
        description: 'בחרו לפחות שורת תביעה פתוחה אחת לפני יצירת הדרישה.',
      };
    case 'stale_selection':
      return {
        title: 'חלק מהבחירה כבר לא עדכנית',
        description: 'המערכת התעלמה משורות שכבר אינן זמינות. בדקו את הרשימה ובחרו מחדש לפני יצירת הדרישה.',
      };
    case 'mixed_providers':
      return {
        title: 'אי אפשר לערבב גורמים מממנים באותה דרישה',
        description: 'נקה את הבחירה וצור דרישה נפרדת לכל גורם מממן.',
      };
    case 'invalid_payment_amount':
      return {
        title: 'יש להזין סכום תשלום תקין',
        description: 'הזינו סכום חיובי ובדקו שהפורמט תקין.',
      };
    case 'payment_above_balance':
      return {
        title: 'סכום התשלום גבוה מהיתרה הפתוחה',
        description: 'הקטינו את הסכום או חלקו את התשלום בין דרישות מתאימות.',
      };
    case 'missing_payment_reference':
      return {
        title: 'חסרה אסמכתת תשלום',
        description: 'הגורם המממן הזה מחייב אסמכתה. הזינו אותה לפני השמירה.',
      };
    default:
      return {
        title: 'הפעולה לא הושלמה',
        description: 'בדקו את הנתונים ונסו שוב.',
      };
  }
}
