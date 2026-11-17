-- Manual provenance allocations from inspected supplier receipt lines to an
-- opt-in courier packing trace. These do not prove the lot was supplied by
-- that vendor: mapping is a signed manual assertion by the administrator.
-- A new trace or discrepancy deletes its evidence allocations automatically.
create table if not exists shop_warehouse_trace_receipt_allocations (
  stop_id uuid not null,
  line_index int not null,
  receipt_id uuid not null references shop_supplier_receipts(id) on delete restrict,
  receipt_line_index int not null,
  allocated_qty int not null check(allocated_qty between 1 and 10000),
  recorded_by uuid references users(id) on delete set null,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(stop_id,line_index,receipt_id),
  foreign key(stop_id,line_index) references
    shop_warehouse_line_traces(stop_id,line_index) on delete cascade,
  foreign key(receipt_id,receipt_line_index) references
    shop_supplier_receipt_lines(receipt_id,line_index) on delete restrict,
  constraint shop_trace_receipt_line_index check(line_index=receipt_line_index)
);
create index if not exists shop_trace_allocation_receipt
  on shop_warehouse_trace_receipt_allocations(receipt_id,receipt_line_index);
