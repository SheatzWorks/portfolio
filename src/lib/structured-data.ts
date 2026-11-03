/**
 * JSON-LD Structured Data for SEO and AEO.
 *
 * Provides schema.org markup for Organization, WebSite, WebPage,
 * BreadcrumbList, Service, and Product types.
 */

import { studio } from '~/config/site';
import type { Product, Service, Project } from '~/lib/types';

/** Base URL for the site. */
export function getBaseUrl(): string {
  return studio.siteUrl.replace(/\/+$/, '');
}

/** Organization schema — describes the studio as an entity. */
export function organizationSchema(): object {
  const base = getBaseUrl();
  const social = studio.social
    .filter((s) => !/PLACEHOLDER|example\.(com|org|net)/i.test(s.href))
    .map((s) => s.href);

  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: studio.name,
    url: base,
    logo: `${base}/og-default.png`,
    sameAs: social,
    contactPoint: {
      '@type': 'ContactPoint',
      telephone: '', // No phone published
      contactType: 'customer service',
      availableLanguage: ['English'],
      email: studio.email,
    },
    description: studio.description,
    address: {
      '@type': 'PostalAddress',
      addressCountry: 'Remote',
    },
  };
}

/** WebSite schema — enables sitelinks search box. */
export function webSiteSchema(): object {
  const base = getBaseUrl();
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: studio.name,
    url: base,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${base}/work?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

/** WebPage schema — base for all pages. */
export function webPageSchema(params: {
  url: string;
  name: string;
  description: string;
  image?: string;
  datePublished?: string;
  dateModified?: string;
}): object {
  const base = getBaseUrl();
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    '@id': params.url,
    name: params.name,
    description: params.description,
    url: params.url,
    isPartOf: { '@id': `${base}#website` },
    about: { '@id': `${base}#organization` },
    ...(params.image && { image: params.image }),
    ...(params.datePublished && { datePublished: params.datePublished }),
    ...(params.dateModified && { dateModified: params.dateModified }),
    publisher: { '@id': `${base}#organization` },
  };
}

/** BreadcrumbList schema for navigation. */
export function breadcrumbSchema(items: Array<{ name: string; url: string }>): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

/** Service schema for /services and individual service pages. */
export function serviceSchema(service: Service, baseUrl?: string): object {
  const base = baseUrl ?? getBaseUrl();
  const url = `${base}/services/${service.slug}`;

  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: service.name,
    description: service.outcome,
    url,
    provider: { '@id': `${base}#organization` },
    areaServed: 'Worldwide',
    serviceType: service.engagement ?? 'Fixed scope',
    offers: {
      '@type': 'Offer',
      name: service.name,
      description: service.outcome,
      url,
      priceCurrency: studio.priceCurrency,
      ...(service.priceFrom && { price: service.priceFrom, priceSpecification: { '@type': 'UnitPriceSpecification', priceCurrency: studio.priceCurrency, minPrice: service.priceFrom } }),
      ...(service.priceTo && { priceSpecification: { '@type': 'UnitPriceSpecification', priceCurrency: studio.priceCurrency, maxPrice: service.priceTo } }),
      availability: 'https://schema.org/InStock',
    },
    ...(service.deliverables.length && { hasOfferCatalog: { '@type': 'OfferCatalog', name: 'Deliverables', itemListElement: service.deliverables.map((d) => ({ '@type': 'Offer', name: d })) } }),
  };
}

/** Product schema for /products/[slug] (SoftwareApplication). */
export function productSchema(product: Product): object {
  const base = getBaseUrl();
  const url = `${base}/products/${product.slug}`;
  const imageUrl = product.preview?.thumb ? `${base}/media/${product.preview.thumb}` : `${base}/og-default.png`;

  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: product.title,
    description: product.blurb ?? product.summary ?? studio.description,
    url,
    applicationCategory: product.kind,
    operatingSystem: 'Cloud / Web',
    offers: {
      '@type': 'Offer',
      name: product.title,
      url,
      priceCurrency: studio.priceCurrency,
      availability: product.productStatus === 'live' ? 'https://schema.org/InStock' : 'https://schema.org/PreOrder',
      ...(product.availabilityUrl && { availableAtOrFrom: product.availabilityUrl }),
    },
    image: imageUrl,
    publisher: { '@id': `${base}#organization` },
    ...(product.technologies.length && { keywords: product.technologies.join(', ') }),
  };
}

/** CreativeWork schema for /work/[slug] (case studies). */
export function caseStudySchema(project: Project): object {
  const base = getBaseUrl();
  const prefix = project.ownership === 'own' ? '/products' : '/work';
  const url = `${base}${prefix}/${project.slug}`;
  const imageUrl = project.preview?.thumb ? `${base}/media/${project.preview.thumb}` : `${base}/og-default.png`;

  return {
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: project.title,
    description: project.blurb ?? project.summary ?? studio.description,
    url,
    creator: { '@id': `${base}#organization` },
    publisher: { '@id': `${base}#organization` },
    ...(project.technologies.length && { keywords: project.technologies.join(', ') }),
    ...(project.year && { datePublished: `${project.year}-01-01` }),
    image: imageUrl,
    ...(project.credits.length && { contributor: project.credits.map((c) => ({ '@type': 'Person', name: c.name, roleName: c.role })) }),
  };
}

/** FAQPage schema for pages with FAQ sections. */
export function faqSchema(faqs: Array<{ question: string; answer: string }>): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  };
}

/** Render JSON-LD as a script tag. */
export function renderJsonLd(data: object | object[]): string {
  const json = JSON.stringify(data, null, 2);
  return `<script type="application/ld+json">${json}</script>`;
}