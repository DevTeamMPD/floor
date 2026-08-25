-- Keep shared purchase-order visibility without overlapping permissive SELECT policies.
drop policy if exists purchase_orders_warehouse_manage on public.purchase_orders;

create policy purchase_orders_warehouse_insert on public.purchase_orders
  for insert to authenticated
  with check ((select public.floor_staff_has_role(array['admin','warehouse'])));

create policy purchase_orders_warehouse_update on public.purchase_orders
  for update to authenticated
  using ((select public.floor_staff_has_role(array['admin','warehouse'])))
  with check ((select public.floor_staff_has_role(array['admin','warehouse'])));

create policy purchase_orders_warehouse_delete on public.purchase_orders
  for delete to authenticated
  using ((select public.floor_staff_has_role(array['admin','warehouse'])));

notify pgrst,'reload schema';
