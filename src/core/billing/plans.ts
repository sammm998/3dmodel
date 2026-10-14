/**
 * Subscription plans. Single source of truth for the pricing page, the
 * account page and server-side limit enforcement. Prices are display values;
 * the amount actually charged is the Stripe Price configured per plan
 * (STRIPE_PRICE_PRO_MONTHLY, …) — keep the two in sync.
 */
export type PlanId = 'free' | 'pro' | 'studio';
export type BillingInterval = 'monthly' | 'yearly';
export type ExportFormat = 'glb' | 'obj' | 'stl' | 'ifc' | 'dxf';

export interface PlanLimits {
  /** Max projects (null = unlimited). */
  projects: number | null;
  /** Server AI requests per calendar month (LLM commands, drawing recognition, server speech). */
  aiRequests: number;
  exportFormats: ExportFormat[];
}

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  /** Price per month in CURRENCY when billed monthly. */
  monthly: number;
  /** Effective price per month in CURRENCY when billed yearly. */
  yearly: number;
  limits: PlanLimits;
  features: string[];
  highlight?: boolean;
}

export const CURRENCY = 'EUR';
export const CURRENCY_SYMBOL = '€';

const ALL_FORMATS: ExportFormat[] = ['glb', 'obj', 'stl', 'ifc', 'dxf'];

export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'For exploring ideas and first sketches.',
    monthly: 0,
    yearly: 0,
    limits: { projects: 3, aiRequests: 40, exportFormats: ['glb', 'obj', 'stl'] },
    features: [
      '3 projects',
      '40 AI requests per month',
      'Unlimited edits with the built-in interpreter',
      'Text, voice and drawing-to-3D',
      'Realistic renders, first-person walk-through and drone videos',
      'Version history and read-only share links',
      'GLB, OBJ and STL export',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'For architects and designers in daily practice.',
    monthly: 29,
    yearly: 24,
    highlight: true,
    limits: { projects: null, aiRequests: 1000, exportFormats: ALL_FORMATS },
    features: [
      'Unlimited projects',
      '1,000 AI requests per month',
      'IFC (BIM) and DXF (CAD) export',
      'Everything in Free',
    ],
  },
  {
    id: 'studio',
    name: 'Studio',
    tagline: 'For studios producing many schemes a month.',
    monthly: 79,
    yearly: 66,
    limits: { projects: null, aiRequests: 5000, exportFormats: ALL_FORMATS },
    features: ['Unlimited projects', '5,000 AI requests per month', 'Priority email support', 'Everything in Pro'],
  },
];

export function getPlan(id: PlanId | string | null | undefined): Plan {
  return PLANS.find((p) => p.id === id) ?? PLANS[0];
}

/** Billing period key for monthly usage counters (UTC calendar month). */
export function usagePeriod(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function formatPrice(n: number): string {
  return `${CURRENCY_SYMBOL}${n}`;
}
