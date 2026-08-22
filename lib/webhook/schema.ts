import { z } from "zod";

/**
 * Zod schema for `work_order.queued.v1` -- SYSTEM_INTEGRATION_SPEC.md v2.1 §4.
 *
 * `.nullable()` is applied exactly where the spec's payload sample annotates
 * a field as `"string|null"`. Fields the spec always shows with a real
 * example value (not the `string|null` placeholder) are required, EXCEPT
 * `work_orders[].install_start/install_end`: §3's edge-case guard explicitly
 * allows the CRM trigger to send `null` there (bad BE/CE year sanity check)
 * so those two must be nullable too even though the §4 sample shows dates.
 * The free-text `tasks.*` / `constraints.*` sub-fields are treated the same
 * as their siblings `task_details`/`manpower` (explicitly nullable) since
 * they are the same kind of optional descriptive text -- not every work
 * order touches every task category or hits every site constraint.
 *
 * Top-level `.passthrough()` so a field the CRM adds later (payload grows,
 * receiver doesn't) never causes the whole event to be rejected wholesale.
 */

const LineItemSchema = z.object({
  description: z.string(),
  qty: z.number(),
  unit: z.string(),
  unitPrice: z.number(),
  vatIncluded: z.boolean(),
  imageUrl: z.string().nullable(),
});

const TasksSchema = z.object({
  ball_pit: z.string().nullable(),
  workshop_set: z.string().nullable(),
  gym: z.string().nullable(),
  floor: z.string().nullable(),
  other: z.string().nullable(),
});

const ConstraintsSchema = z.object({
  access_time: z.string().nullable(),
  logistics: z.string().nullable(),
  work_area: z.string().nullable(),
  obstacles: z.string().nullable(),
  ground: z.string().nullable(),
  utilities: z.string().nullable(),
  noise_dust: z.string().nullable(),
  weather: z.string().nullable(),
  site_authority: z.string().nullable(),
});

const WorkOrderSchema = z.object({
  seq: z.number(),
  install_start: z.string().nullable(),
  install_end: z.string().nullable(),
  location_address: z.string().nullable(),
  location_map_link: z.string().nullable(),
  contact_name: z.string().nullable(),
  contact_phone: z.string().nullable(),
  task_details: z.string().nullable(),
  manpower: z.string().nullable(),
  tasks: TasksSchema,
  constraints: ConstraintsSchema,
  design_images: z.array(z.string()),
  site_photos: z.array(z.string()),
  materials: z.string().nullable(),
  acceptance_criteria: z.string().nullable(),
});

export const WorkOrderQueuedV1Schema = z
  .object({
    event: z.object({
      event_id: z.string(),
      event_type: z.string(),
      occurred_at: z.string(),
      source_system: z.string(),
    }),
    production: z.object({
      // dedup key (D9) -- X-Idempotency-Key and install_jobs.external_id
      production_id: z.string(),
      status: z.string(),
      status_code: z.string(),
      supplier_name: z.string().nullable(),
      assignee: z.string().nullable(),
      tier: z.string().nullable(),
      notes: z.string().nullable(),
    }),
    quotation: z.object({
      // display-only per D9 -- NEVER used as a dedup/unique key
      quotation_number: z.string(),
      quotation_id: z.string().nullable(),
      quote_date: z.string(),
      currency: z.string(),
      subtotal: z.number(),
      vat: z.number(),
      wht: z.number(),
      grand_total: z.number(),
      line_items: z.array(LineItemSchema),
    }),
    customer: z.object({
      customer_id: z.string().nullable(),
      name: z.string().nullable(),
      tax_id: z.string().nullable(),
      address: z.string().nullable(),
      phone: z.string().nullable(),
      email: z.string().nullable(),
      line_id: z.string().nullable(),
    }),
    work_orders: z.array(WorkOrderSchema),
    summary: z.object({
      install_start: z.string().nullable(),
      install_end: z.string().nullable(),
      work_order_count: z.number(),
      // §3 edge case: set true when a work order's install date failed the
      // 2000-2100 sanity check and was nulled out instead of forwarded.
      date_warning: z.boolean().optional(),
    }),
  })
  .passthrough();

export type WorkOrderQueuedV1 = z.infer<typeof WorkOrderQueuedV1Schema>;
