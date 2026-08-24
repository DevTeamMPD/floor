-- Add ref_po_id to stock_movements for PO receiving traceability.
alter table public.stock_movements
  add column if not exists ref_po_id uuid
  references public.purchase_orders(id) on delete set null;

comment on column public.stock_movements.ref_po_id is
  'Reference to purchase_orders for PO receiving movements';
