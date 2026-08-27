ALTER TABLE churches
ADD COLUMN packet_footer_message TEXT NOT NULL DEFAULT 'Ye are the light of the world.';

ALTER TABLE churches
ADD COLUMN packet_footer_reference TEXT NOT NULL DEFAULT 'Matthew 5:14';
