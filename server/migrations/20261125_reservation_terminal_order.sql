-- #170: explicit terminal order transitions release only linked reservations.
-- Do not backfill historical rows or infer completion from the clock.
-- Existing order cancellation/completion notification and accounting flows
-- are untouched. Linked negotiation HTTP/notification support is not enabled.
CREATE OR REPLACE FUNCTION sync_terminal_order_reservations() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  item record;
  next_status text;
  changed_at timestamptz;
  reason_text text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status NOT IN ('cancelled','completed') THEN
    RETURN NEW;
  END IF;

  changed_at := CASE WHEN NEW.status='cancelled' THEN coalesce(NEW.cancelled_at,now())
                     ELSE coalesce(NEW.completed_at,now()) END;

  FOR item IN
    SELECT * FROM performer_time_reservations
      WHERE order_id=NEW.id AND client_id=NEW.client_id
        AND status IN ('proposed','selected','confirmed')
      ORDER BY id FOR UPDATE
  LOOP
    -- Only a previously confirmed appointment with the actually assigned
    -- performer can inherit a real completed order. Unaccepted alternatives
    -- are closed as cancelled, never upgraded to completed.
    IF NEW.status='completed' AND item.status='confirmed' AND NEW.performer_id=item.performer_id THEN
      next_status := 'completed';
      reason_text := NULL;
    ELSE
      next_status := 'cancelled';
      reason_text := CASE WHEN NEW.status='cancelled' THEN 'Связанная заявка отменена'
                           ELSE 'Связанная заявка завершена без этой записи' END;
    END IF;

    UPDATE performer_time_reservations
      SET status=next_status,
          cancelled_at=CASE WHEN next_status='cancelled' THEN changed_at ELSE NULL END,
          cancellation_reason=reason_text,
          move_state=NULL,move_starts_at=NULL,move_ends_at=NULL,move_actor_id=NULL,
          updated_at=changed_at,
          agreement_version=CASE WHEN agreement_version>0 THEN agreement_version+1 ELSE 0 END
      WHERE id=item.id;

    INSERT INTO performer_time_reservation_events
      (reservation_id,actor_id,event_type,before_status,after_status,details)
    VALUES(item.id,NULL,'linked_order_terminal',item.status,next_status,
      jsonb_build_object('orderId',NEW.id,'orderStatus',NEW.status,
        'previousOrderStatus',OLD.status,'observedAt',changed_at,
        'source','explicit_order_transition'));
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER performer_reservations_terminal_order
  AFTER UPDATE OF status ON orders
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION sync_terminal_order_reservations();
