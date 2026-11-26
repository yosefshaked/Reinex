# Israeli payroll components for gross pay
Status: adopted into [`../product/payroll.md`](../product/payroll.md) (PAY-G1, PAY-K, LV-1 to LV-5)
Updated: 2026-11-26

Reinex computes gross pay components and hands them to the accountant (PD8). This document keeps the legal research behind those rules. **It is not legal advice:** every conclusion here needs the farm's accountant or payroll advisor, and the open checks are tracked in [#56](https://github.com/yosefshaked/Reinex/issues/56).

## Which legal components apply, and with what values?
**Conclusion:** seven components, each to be a dated farm setting with its source and a legal default the farm can edit (PAY-K1 to PAY-K7):

| Component | Value as of 2026-09-17 | Source |
|---|---|---|
| Hourly minimum wage | 35.40 ₪ (monthly 6,443.85 ₪), from 1.4.2026; lower youth rates under 18 | [כל-זכות: שכר מינימום](https://www.kolzchut.org.il/he/%D7%A9%D7%9B%D7%A8_%D7%9E%D7%99%D7%A0%D7%99%D7%9E%D7%95%D7%9D) |
| Recuperation day rate (private sector) | 451.50 ₪ (extension order published 18.8.2026, effective from 1.7.2025), after 1 year, days by seniority × job scope | [מלם שכר](https://www.malam-payroll.com/%D7%A2%D7%93%D7%9B%D7%95%D7%9F-%D7%AA%D7%A2%D7%A8%D7%99%D7%A3-%D7%99%D7%95%D7%9D-%D7%94%D7%91%D7%A8%D7%90%D7%94-%D7%9C%D7%A9%D7%A0%D7%AA-2026-%D7%91%D7%9E%D7%92%D7%96%D7%A8-%D7%94%D7%A4%D7%A8%D7%98/), [כל-זכות: דמי הבראה](https://www.kolzchut.org.il/he/%D7%93%D7%9E%D7%99_%D7%94%D7%91%D7%A8%D7%90%D7%94) |
| Travel reimbursement | actual cost up to 22.60 ₪ a working day; half for one direction | [bizportal](https://www.bizportal.co.il/career/news/article/20035635) |
| Holiday pay | up to 9 days a year for hourly workers after 3 months, for a holiday on a scheduled work day (not Friday or Saturday), if they worked or were excused the day before and after; average daily hours over 3 months × hourly rate; salaried employees get it in their salary | [כל-זכות: דמי חגים](https://www.kolzchut.org.il/he/%D7%93%D7%9E%D7%99_%D7%97%D7%92%D7%99%D7%9D) |
| Sick pay | 1.5 days a month (maximum 90); day 1: 0%, days 2–3: 50%, from day 4: 100%; a medical certificate | [כל-זכות: ימי מחלה](https://www.kolzchut.org.il/he/%D7%99%D7%9E%D7%99_%D7%9E%D7%97%D7%9C%D7%94) |
| Record of hours | the employer keeps every employee's actual hours (Work Hours and Rest Law, section 25) | [gov.il: רישום שעות עבודה](https://www.gov.il/he/pages/work-hours-documentation) |
| Pay date | by the 9th of the following month | [כל-זכות: מועד תשלום השכר](https://www.kolzchut.org.il/he/%D7%9E%D7%95%D7%A2%D7%93_%D7%AA%D7%A9%D7%9C%D7%95%D7%9D_%D7%94%D7%A9%D7%9B%D7%A8) |

**Evidence:** the sources above, read on 2026-09-17 (originally section K of `payroll-scenarios.md`, now [`../plans/payroll/payroll-scenarios.md`](../plans/payroll/payroll-scenarios.md)).
**Limits:** values change; each one must be re-checked when it is built. Not researched: the recuperation seniority table, collective agreements that may apply to a farm, pension, severance, tax and national insurance.

## How many leave days does a year give?
**Conclusion:** by the Annual Leave Law (amended from 1.1.2017): seniority is calendar years touched; gross days 16 for years 1–5, 18, 21, then one more a year up to 28 from year 14; converted to working days by `net = W × ⌊gross / 7⌋ + min(gross mod 7, W)` (W = 5 or 6). A whole year is full from 200 days worked, a year started part-way from 240; below that, pro rata. Hourly and daily workers are covered after 75 consecutive days. Built as the "law" option of LV-1 and LV-2; the default is the farm's own fixed table.
**Evidence:** Kol Zchut, read 2026-11-16: [חישוב מספר ימי החופשה השנתית](https://www.kolzchut.org.il/he/חישוב_מספר_ימי_החופשה_השנתית), the [5-day](https://www.kolzchut.org.il/he/חישוב_מספר_ימי_החופשה_השנתית_לעובדים_במקומות_עבודה_שבהם_מונהג_שבוע_עבודה_בן_5_ימים) and [6-day](https://www.kolzchut.org.il/he/חישוב_מספר_ימי_החופשה_השנתית_לעובדים_במקומות_עבודה_שבהם_מונהג_שבוע_עבודה_בן_6_ימים) tables; [the law on Wikisource](https://he.wikisource.org/wiki/חוק_חופשה_שנתית). The net formula reproduces both tables and every worked example on those pages (`tests/leave-entitlement.test.js`). The choices where the law leaves room are in the header of `api/_shared/leave-entitlement.js`.
**Limits** (to confirm with the accountant, [#56](https://github.com/yosefshaked/Reinex/issues/56)):
- the gross → net formula is ours; Kol Zchut does not state it;
- the extension order with a higher 5-day table is not applied; whether it covers horse farms is unknown;
- the system has no employment end date, so leaving or returning within a year cannot be expressed;
- the 75-day threshold is applied to everyone, because the system does not know who is paid by the hour;
- a part-time employee taking one day off is charged one day;
- the 4% minimum for an hourly worker before 75 days, automatic carry-over checks, and redemption at the end of employment are not built.

## How is a leave day valued?
**Conclusion:** salaried employees keep their salary. Otherwise the law's value: the gross wage of the 3 months before the leave ÷ 90 × gross leave days, and if those months were not full, the 3 consecutive months with the most days worked in the 12 before. Paid absence is part of the base. Reinex counts net leave days, so one day = base ÷ 90 × 7 ÷ W. This is "ממוצע מומלץ" (PAY-G1).
**Evidence:** Kol Zchut, [תשלום דמי חופשה](https://www.kolzchut.org.il/he/%D7%AA%D7%A9%D7%9C%D7%95%D7%9D_%D7%93%D7%9E%D7%99_%D7%97%D7%95%D7%A4%D7%A9%D7%94), read 2026-11-18; the Annual Leave Law, section 10; `pay-calculation` test "PAY-G1 the "ממוצע מומלץ" leave value through the monthly pay".
**Limits:** two assumptions, recorded in [#56](https://github.com/yosefshaked/Reinex/issues/56) (2026-11-18): "the fullest window" is the one with the most recorded days worked, the later one on a tie; a new employee employed for part of the window is divided by the calendar days employed in it, not by 90.

## Changes
- 2026-11-26: moved into this document from section K of `payroll-scenarios.md`, the header of `api/_shared/leave-entitlement.js` and issue #56 (repository restructure, stage 4).
