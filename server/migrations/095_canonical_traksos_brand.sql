-- Preserve existing legal details while correcting old display-name values.
-- The public-facing platform identity is always TrakSOS (traksos.ru).
update settings
set value = jsonb_set(value, '{brand}', '"TrakSOS"'::jsonb, true),
    updated_at = now()
where key = 'legal' and value->>'brand' is distinct from 'TrakSOS';
