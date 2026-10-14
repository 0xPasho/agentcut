-- The latest version's cover, as a path inside the pack ('' for none), so a card can show
-- it without reading the manifest. The pack's page reads the screenshots from the manifest.
ALTER TABLE packs ADD COLUMN cover TEXT NOT NULL DEFAULT '';
