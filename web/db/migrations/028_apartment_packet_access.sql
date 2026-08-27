ALTER TABLE packets
ADD COLUMN apartment_access_status TEXT
CHECK (apartment_access_status IS NULL OR apartment_access_status IN ('open', 'restricted'));
