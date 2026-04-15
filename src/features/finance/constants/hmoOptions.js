/**
 * HMO provider/track option constants shared across the finance domain.
 * These are display/form helpers only — no billing logic here.
 */

export const HMO_PAYMENT_MODE_OPTIONS = [
  { value: 'fully_paid_by_hmo', label: 'ממומן במלואו על ידי הגורם המממן' },
  { value: 'partially_paid_by_hmo', label: 'ממומן חלקית על ידי הגורם המממן והיתרה על ידי הלקוח' },
  { value: 'fully_paid_by_customer', label: 'משולם במלואו על ידי הלקוח' },
];

export const HMO_SUGGESTION_OPTIONS = [
  {
    value: 'clalit',
    label: 'כללית',
    providerName: 'כללית',
    paymentMode: 'partially_paid_by_hmo',
    workflowNotes: 'הלקוח משלם השתתפות עצמית, ובסוף חודש שולחים לקופה את תאריכי המפגשים עבור יתרת החיוב.',
  },
  {
    value: 'meuhedet',
    label: 'מאוחדת',
    providerName: 'מאוחדת',
    paymentMode: 'fully_paid_by_hmo',
    workflowNotes: 'עובדים מול טופס 17, הלקוח לא משלם, ובסוף חודש שולחים לקופה את תאריכי המפגשים לתשלום.',
  },
  {
    value: 'leumit',
    label: 'לאומית',
    providerName: 'לאומית',
    paymentMode: 'fully_paid_by_customer',
    workflowNotes: 'הלקוח משלם מלא, מקבל חשבונית, ופונה עצמאית לקופה לצורך ההחזר.',
  },
  {
    value: 'custom',
    label: 'מותאם אישית',
    providerName: '',
    paymentMode: 'partially_paid_by_hmo',
    workflowNotes: '',
  },
];
