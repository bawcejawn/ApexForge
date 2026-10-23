// src/lib/schema.mjs — JSON-LD builders (structured data for rich results).
import { abs } from './site.mjs';

export const faqSchema = (faqs) => faqs.length ? {
  '@context': 'https://schema.org', '@type': 'FAQPage',
  mainEntity: faqs.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } }))
} : null;

export const breadcrumbSchema = (items) => ({
  '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: abs(it.path) }))
});

export const serviceSchema = ({ name, description, areaName, brand }) => ({
  '@context': 'https://schema.org', '@type': 'Service',
  name, description, serviceType: name,
  provider: { '@type': 'Organization', name: brand },
  areaServed: { '@type': 'Place', name: areaName }
});
