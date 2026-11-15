// Tattoo age laws by state and territory, shown when the R18+ badge is tapped.
// Every entry was read from the official legislation register for that jurisdiction.
// Dollar figures use the 2026-27 penalty-unit values where published. Update
// AGE_LAWS_CHECKED whenever these are re-checked.
export interface AgeLaw {
  state: string;
  /** Short headline. */
  rule: string;
  detail: string;
  penalty: string;
  /** Act and section, used as the link text. */
  law: string;
  url: string;
}

export const AGE_LAWS_CHECKED = '15 November 2026';

export const AGE_LAWS: AgeLaw[] = [
  {
    state: 'New South Wales',
    rule: 'Under 18 needs a parent',
    detail:
      'Anyone under 18 needs a parent’s consent for that tattoo on that part of the body, given in person or in writing.',
    penalty:
      'Up to 200 penalty units (about $22,000). A conviction also bars a tattooist from holding a NSW tattoo licence for 10 years, and an existing licence can be cancelled.',
    law: 'Children and Young Persons (Care and Protection) Act 1998, s 230',
    url: 'https://legislation.nsw.gov.au/view/html/inforce/current/act-1998-157#sec.230',
  },
  {
    state: 'Victoria',
    rule: '18+ · no exceptions',
    detail: 'Tattooing anyone under 18 is a crime, even with a parent’s consent.',
    penalty: 'Up to 60 penalty units (about $12,500).',
    law: 'Summary Offences Act 1966, s 42',
    url: 'https://www.legislation.vic.gov.au/in-force/acts/summary-offences-act-1966',
  },
  {
    state: 'Queensland',
    rule: '18+ · no exceptions',
    detail: 'Tattooing anyone under 18 is a crime, even with a parent’s consent. This includes cosmetic tattooing.',
    penalty: 'Up to 40 penalty units (about $6,900) or 6 months’ imprisonment. A conviction can also count against a tattooist’s licence.',
    law: 'Summary Offences Act 2005, s 19',
    url: 'https://www.legislation.qld.gov.au/view/html/inforce/current/act-2005-004#sec.19',
  },
  {
    state: 'South Australia',
    rule: '18+ · no exceptions',
    detail:
      'Tattooing anyone under 18 is a crime, even with a parent’s consent. Every tattoo, at any age, also needs a signed written agreement first.',
    penalty: 'Up to $5,000 or 12 months’ imprisonment.',
    law: 'Summary Offences Act 1953, s 21R',
    url: 'https://www.legislation.sa.gov.au/lz?path=%2FC%2FA%2FSUMMARY%20OFFENCES%20ACT%201953',
  },
  {
    state: 'Western Australia',
    rule: '16+ · written consent under 18',
    detail:
      'Tattooing anyone under 16 is a crime, even with consent. At 16 or 17, a parent must give written consent first for that tattoo on that part of the body.',
    penalty: 'Up to a $12,000 fine and 1 year’s imprisonment.',
    law: 'Children and Community Services Act 2004, s 103',
    url: 'https://www.legislation.wa.gov.au/legislation/statutes.nsf/law_a9243.html',
  },
  {
    state: 'Tasmania',
    rule: '18+ · no exceptions',
    detail: 'Tattooing anyone under 18 is a crime, even with a parent’s consent (since December 2014).',
    penalty: 'Up to 100 penalty units (about $21,000) or 12 months’ imprisonment.',
    law: 'Police Offences Act 1935, s 35A',
    url: 'https://www.legislation.tas.gov.au/view/html/inforce/current/act-1935-044',
  },
  {
    state: 'Australian Capital Territory',
    rule: 'Under 18 needs written consent',
    detail:
      'Anyone under 18 needs written agreement from a parent or carer for that tattoo on that part of the body. Consent in person is not enough.',
    penalty: 'Up to 50 penalty units (about $8,000; $40,500 for a company).',
    law: 'Children and Young People Act 2008, s 877',
    url: 'https://www.legislation.act.gov.au/a/2008-19/',
  },
  {
    state: 'Northern Territory',
    rule: 'No specific age law',
    detail: 'The NT has no law setting a minimum age for tattoos, so each studio sets its own rules.',
    penalty: 'No specific penalty. General criminal and civil law still applies.',
    law: 'NT legislation search',
    url: 'https://legislation.nt.gov.au',
  },
];
