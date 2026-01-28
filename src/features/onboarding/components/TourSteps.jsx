/**
 * Tour step definitions for admin/owner and member/instructor roles
 * Each step targets a specific UI element and provides contextual help
 */

function findVisibleElement(selector) {
  if (!selector) return null;

  const candidates = document.querySelectorAll(selector);
  for (const element of candidates) {
    if (!element) continue;

    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const hasSize = rect.width > 0 && rect.height > 0;
    const isHidden =
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      parseFloat(style.opacity || '1') === 0;

    if (!isHidden && hasSize) {
      return element;
    }
  }

  return null;
}

const selectVisible = (selector) => () => findVisibleElement(selector);

export const adminTourSteps = [
  {
    element: 'body',
    popover: {
      title: 'ברוכים הבאים לריינקס! 👋',
      description: 'מערכת לניהול ותיעוד מפגשים עם תלמידים. בואו נעשה סיור קצר כדי להכיר את התכונות העיקריות.',
      side: 'over',
      align: 'center',
    },
  },
  {
    element: selectVisible('[data-tour="dashboard"]'),
    popover: {
      title: 'מסך ראשי',
      description: 'מסך הבית שלכם - מכאן תוכלו לראות את הסטטוס הכללי ולעבור דרך התפריט הימני לכל המסכים המרכזיים.',
      side: 'top',
      align: 'center',
    },
  },
  {
    element: selectVisible('[data-tour="admin-students"]'),
    popover: {
      title: 'ניהול תלמידים',
      description: 'לחצו על פריט התפריט הזה כדי לנהל את רשימת התלמידים, להוסיף תלמידים חדשים ולצפות בפרטיהם.',
      side: 'top',
      align: 'center',
    },
  },
  {
    element: selectVisible('[data-tour="fab-button"]'),
    popover: {
      title: 'הוספת מפגש חדש',
      description: 'לחצו על הכפתור בתפריט הימני כדי לפתוח טופס רישום מפגש חדש ולתעד את פרטי המפגש.',
      side: 'top',
      align: 'center',
    },
  },
  {
    element: selectVisible('[data-tour="settings"]'),
    popover: {
      title: 'הגדרות ארגון',
      description: 'בהגדרות תוכלו לנהל משתמשים, להזמין מדריכים חדשים, ולהגדיר העדפות ארגוניות.',
      side: 'top',
      align: 'center',
    },
  },
  {
    element: 'body',
    popover: {
      title: 'מוכנים להתחיל! 🚀',
      description: 'זהו! אתם מוכנים להתחיל לתעד מפגשים. תמיד תוכלו לחזור למדריך דרך ההגדרות → "סיור מודרך במערכת"',
      side: 'over',
      align: 'center',
    },
  },
];

export const memberTourSteps = [
  {
    element: 'body',
    popover: {
      title: 'ברוכים הבאים לריינקס! 👋',
      description: 'מערכת לתיעוד ומעקב אחר המפגשים שלכם עם תלמידים. בואו נעשה סיור קצר כדי להכיר את המערכת.',
      side: 'over',
      align: 'center',
    },
  },
  {
    element: selectVisible('[data-tour="dashboard"]'),
    popover: {
      title: 'מסך ראשי',
      description: 'מסך הבית שלכם - מכאן תוכלו לראות את הסטטוס הכללי ולעבור דרך התפריט הימני למסכים המרכזיים.',
      side: 'top',
      align: 'center',
    },
  },
  {
    element: selectVisible('[data-tour="my-students"]'),
    popover: {
      title: 'התלמידים שלי',
      description: 'לחצו על פריט התפריט הזה כדי לצפות ברשימת התלמידים שלכם ולעקוב אחר ההתקדמות שלהם.',
      side: 'top',
      align: 'center',
    },
  },
  {
    element: selectVisible('[data-tour="fab-button"]'),
    popover: {
      title: 'הוספת מפגש חדש',
      description: 'לחצו על הכפתור בתפריט הימני כדי לפתוח טופס רישום מפגש חדש עם תלמיד.',
      side: 'top',
      align: 'center',
    },
  },
  {
    element: 'body',
    popover: {
      title: 'מוכנים להתחיל! 🚀',
      description: 'זהו! אתם מוכנים להתחיל לתעד מפגשים עם התלמידים שלכם. תמיד תוכלו לחזור למדריך דרך ההגדרות → "סיור מודרך במערכת"',
      side: 'over',
      align: 'center',
    },
  },
];

export function getTourSteps(isAdmin) {
  return isAdmin ? adminTourSteps : memberTourSteps;
}
