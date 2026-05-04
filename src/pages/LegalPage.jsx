import React from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { ArrowRight, FileText, ShieldAlert } from 'lucide-react';
import { legalPageMap, legalPages } from '@/legal/legalContent.js';

function LegalTable({ table }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="w-full min-w-[720px] border-collapse text-right text-sm">
        <thead className="bg-slate-50 text-slate-700">
          <tr>
            {table.columns.map((column) => (
              <th key={column} className="border-b border-slate-200 px-4 py-3 font-semibold">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, index) => (
            <tr key={`${row[0]}-${index}`} className="border-b border-slate-100 last:border-b-0">
              {row.map((cell, cellIndex) => (
                <td key={`${cell}-${cellIndex}`} className="px-4 py-3 align-top leading-6 text-slate-700">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LegalSection({ section }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-bold text-slate-950">{section.title}</h2>
      {section.paragraphs?.map((paragraph) => (
        <p key={paragraph} className="mt-4 leading-8 text-slate-700">
          {paragraph}
        </p>
      ))}
      {section.bullets ? (
        <ul className="mt-4 space-y-2 leading-7 text-slate-700">
          {section.bullets.map((bullet) => (
            <li key={bullet} className="flex gap-2">
              <span className="mt-3 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-400" aria-hidden="true" />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {section.table ? (
        <div className="mt-5">
          <LegalTable table={section.table} />
        </div>
      ) : null}
    </section>
  );
}

function LegalIndex() {
  return (
    <LegalLayout title="מסמכי מדיניות ומשפט" summary="טיוטות MVP ציבוריות עבור Reinex. המסמכים אינם ייעוץ משפטי ודורשים בדיקה לפני השקה חיצונית.">
      <div className="grid gap-4 md:grid-cols-2">
        {legalPages.map((page) => (
          <Link
            key={page.slug}
            to={`/legal/${page.slug}`}
            className="group rounded-3xl border border-slate-200 bg-white p-5 text-right shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
          >
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-blue-50 p-3 text-blue-700">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{page.priority}</p>
                <h2 className="mt-1 text-lg font-bold text-slate-950 group-hover:text-blue-700">{page.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{page.summary}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </LegalLayout>
  );
}

function LegalLayout({ title, summary, children }) {
  return (
    <div dir="rtl" className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link to="/" className="inline-flex items-center gap-2 rounded-xl text-sm font-semibold text-slate-700 hover:text-blue-700">
            <ArrowRight className="h-4 w-4" />
            חזרה לדף הבית
          </Link>
          <Link to="/legal" className="inline-flex items-center gap-2 text-sm font-bold text-slate-900">
            <img src="/icon.svg" alt="" className="h-6 w-6" />
            Reinex Legal
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-8 rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-1 h-5 w-5 flex-shrink-0" />
            <p className="leading-7">
              מסמכים אלה הם טיוטות MVP לצורך שקיפות והכנה תפעולית. הם אינם ייעוץ משפטי, אינם מאושרים על ידי עורך דין,
              ואינם טוענים לעמידה מלאה בדרישות חוק, תקן או רגולציה.
            </p>
          </div>
        </div>
        <div className="mb-8">
          <p className="text-sm font-semibold text-blue-700">עודכן: 03/05/2026</p>
          <h1 className="mt-2 text-4xl font-black tracking-tight text-slate-950">{title}</h1>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-600">{summary}</p>
        </div>
        {children}
      </main>
    </div>
  );
}

export default function LegalPage() {
  const { slug } = useParams();

  if (!slug) {
    return <LegalIndex />;
  }

  const page = legalPageMap[slug];
  if (!page) {
    return <Navigate to="/legal" replace />;
  }

  return (
    <LegalLayout title={page.title} summary={page.summary}>
      <div className="space-y-5">
        {page.sections.map((section) => (
          <LegalSection key={section.title} section={section} />
        ))}
      </div>
      <nav className="mt-8 flex flex-wrap gap-3">
        <Link to="/legal" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:border-blue-200 hover:text-blue-700">
          כל המסמכים
        </Link>
        <Link to="/legal/privacy" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:border-blue-200 hover:text-blue-700">
          מדיניות פרטיות
        </Link>
        <Link to="/legal/cookies" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:border-blue-200 hover:text-blue-700">
          Cookies ואחסון בדפדפן
        </Link>
      </nav>
    </LegalLayout>
  );
}

