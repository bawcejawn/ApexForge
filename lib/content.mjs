// lib/content.mjs
// -----------------------------------------------------------------------------
// Prompts, template fallbacks, SEO metadata and the compliance linter for
// generated pages. Every page gets:
//   - title / description / h1 (deterministic, keyword-targeted)
//   - body markdown (AI if available, otherwise a solid template)
//   - reviewed: false  -> flip to true after a human reads it
// -----------------------------------------------------------------------------
import { fill } from './core.mjs';

/** "Main | Brand" if it fits in ~62 chars (Google's display width), else just "Main". */
const titled = (main, brand) => (`${main} | ${brand}`.length <= 62 ? `${main} | ${brand}` : main);

/** SEO metadata per page. Deterministic so titles never drift between runs. */
export function pageMeta(page, { site, vertical }) {
  const st = site.state;
  if (page.kind === 'home') {
    const city = site.cities[0]?.name;
    return {
      title: titled(`${vertical.label} Quotes in ${city}, ${st}`, site.brand),
      description: `Compare ${vertical.label.toLowerCase()} options in ${city} and across ${site.stateName}. Free, no-obligation help from licensed local professionals.`,
      h1: fill(vertical.heroTitle, { city: `${city}, ${st}` })
    };
  }
  const svc = page.service;
  if (page.kind === 'service') {
    return {
      title: titled(`${svc.name} in ${site.stateName}`, site.brand),
      description: `How ${svc.keyword} works in ${site.stateName}: who it fits, what affects cost, and how to compare options with a licensed professional.`,
      h1: `${svc.name} in ${site.stateName}`
    };
  }
  const c = page.city;
  return {
    title: titled(`${svc.name} in ${c.name}, ${st}`, site.brand),
    description: `Looking for ${svc.keyword} in ${c.name}, ${st}? See how it works locally and get matched with a licensed professional. Free and no obligation.`,
    h1: `${svc.name} in ${c.name}, ${st}`
  };
}

export function systemPrompt({ site, vertical }) {
  const rules = (vertical.compliance?.contentRules || []).map(r => `- ${r}`).join('\n');
  return `You are a senior consumer-finance writer creating helpful, accurate web pages for ${site.brand}, a lead-matching service (not a provider).
Write for ${vertical.audience}. Plain English, 8th-grade reading level, warm and direct. No hype.
Output GitHub-flavored markdown only. Start with a short intro paragraph (no H1). Use 4-6 "##" sections, short paragraphs, and at most one bulleted list.
Hard rules:
${rules}
- Do not invent statistics, laws, company names, prices, or quotes. If unsure, speak generally.
- Do not include an FAQ section, a call to action button, or contact details (the page template adds those).
- Never mention that you are an AI.`;
}

export function userPrompt(page, ctx) {
  const { site } = ctx;
  const meta = pageMeta(page, ctx);
  if (page.kind === 'home') {
    return `Write the body of the homepage titled "${meta.h1}". Explain what ${ctx.vertical.label.toLowerCase()} options people in ${site.cities.map(c => c.name).join(', ')} typically compare, how our free matching works (short form -> a licensed professional calls -> you compare options, no obligation), and how to prepare. 500-700 words.`;
  }
  const svc = page.service;
  if (page.kind === 'service') {
    return `Write a guide titled "${meta.h1}". Focus: ${svc.angle}. Cover who it fits, how it works, what affects cost or eligibility (generally), common mistakes, and how to compare options in ${site.stateName}. 800-1100 words.`;
  }
  const c = page.city;
  const local = c.localNotes ? `Local facts you MUST weave in naturally (do not invent others): ${c.localNotes}` :
    `No local facts were provided — keep local references general (e.g. the ${c.name} area), do not invent landmarks, employers or numbers.`;
  return `Write a local page titled "${meta.h1}". Focus: ${svc.angle}. Make it useful for someone in ${c.name}, ${site.state} specifically. ${local}
Cover: why people in ${c.name} look into ${svc.keyword}, how it works, what to have ready, and how to compare options. 600-900 words.`;
}

/** Template fallback — used when no LLM is reachable. Readable, compliant, not thin. */
export function templateBody(page, { site, vertical }) {
  const v = vertical.label.toLowerCase();
  const cityList = site.cities.slice(0, 6).map(c => c.name).join(', ');
  if (page.kind === 'home') {
    return `
Choosing ${v} is easier when someone explains your options in plain English. ${site.brand} connects people in ${cityList} and across ${site.stateName} with licensed professionals who can compare options for you, at no cost and with no obligation.

## How it works

1. **Answer a few quick questions.** It takes about a minute and helps match you with the right professional.
2. **A licensed professional contacts you.** They review your situation and explain the options that fit.
3. **Compare and decide.** There is never any obligation to buy or apply.

## What people here usually compare

${vertical.services.map(s => `- **${s.name}:** ${s.angle}.`).join('\n')}

## How to prepare

Have a rough idea of your goals, your budget, and your timeline. You do not need documents to get started. A professional will tell you exactly what is needed if you decide to move forward.

## Why use a local professional

Rules, products and pricing can vary by state and by provider. A licensed professional who works in ${site.stateName} can explain what applies to you and answer questions before you commit to anything.
`;
  }
  const svc = page.service;
  const where = page.kind === 'local' ? `${page.city.name}, ${site.state}` : site.stateName;
  const local = page.kind === 'local' && page.city.localNotes ? `\n\n${page.city.localNotes}` : '';
  return `
If you are researching ${svc.keyword} in ${where}, you are probably weighing ${svc.angle}. This page explains how it works, what affects your options, and how to compare them without pressure.${local}

## Who ${svc.name.toLowerCase()} is a good fit for

${svc.name} tends to fit people focused on ${svc.angle}. Your age, goals, budget, and timeline all shape which option makes the most sense, so it is worth comparing more than one.

## How it works

A licensed professional reviews your situation, explains the options available in ${site.stateName}, and walks you through the next steps if you decide to proceed. Eligibility and pricing are set by the provider and depend on your details.

## What affects your options

- Your goals and how long you need the coverage or product to last
- Your budget and what you are comfortable committing to
- Your personal and financial profile, which providers evaluate differently
- Timing: some options take longer to put in place than others

## Mistakes to avoid

Deciding on price alone, not reading the terms, and waiting too long are the most common. Ask how the option works over time, what happens if your situation changes, and what costs could apply.

## Comparing options in ${where}

Use the short form on this page to get matched with a licensed professional. You can ask questions, compare choices side by side, and decide on your own schedule. There is no cost and no obligation.
`;
}

/** Patterns that create legal or credibility risk in this industry. */
const RISK = [
  [/\$\s?\d[\d,.]*\s*(\/|per)\s*(mo|month)/i, 'specific monthly price'],
  [/\b\d+(\.\d+)?\s?%\s*(apr|interest|rate)/i, 'specific rate/APR'],
  [/\bguarantee(d)?\b(?!.{0,20}issue)/i, '"guaranteed" claim'],
  [/\b(pre-?approved|instant approval|no credit check)\b/i, 'approval claim'],
  [/\b(government|medicare|federal)[- ](program|approved|affiliated)\b/i, 'government affiliation'],
  [/\b(as an ai|language model)\b/i, 'AI self-reference'],
  [/\b(best|lowest|cheapest) (rates?|price) (in|guaranteed)\b/i, 'superlative price claim']
];

export function lintBody(body) {
  return RISK.filter(([re]) => re.test(body)).map(([, why]) => why);
}
