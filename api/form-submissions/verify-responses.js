/**
 * The response bodies of a failed public-form verification. The wording is our own Hebrew business
 * copy, so each body carries the user-message marker (docs/project-rules/30).
 */
import { withUserMessage } from '../_shared/user-message.js';

export const INVALID_VERIFY_MESSAGE = 'מזהה או קוד אימות שגויים';
export const OTP_INVALID_OR_EXPIRED_MESSAGE = 'קוד האימות שגוי או שפג תוקפו';
export const VERIFY_LOCKDOWN_MESSAGE = 'מטעמי אבטחה, כל הקישורים הפעילים עבור תלמיד זה בוטלו עקב יותר מדי נסיונות כושלים. יש ליצור קשר עם המרפאה לקבלת קוד חדש.';

/** 401: the id or the code does not match. */
export const invalidVerifyBody = () => withUserMessage({ message: INVALID_VERIFY_MESSAGE });
/** 401: the one-time code is wrong or expired. */
export const otpInvalidOrExpiredBody = () => withUserMessage({ message: OTP_INVALID_OR_EXPIRED_MESSAGE });
/** 429: too many failures; the student's active links were revoked. */
export const verifyLockdownBody = () => withUserMessage({ message: VERIFY_LOCKDOWN_MESSAGE });
