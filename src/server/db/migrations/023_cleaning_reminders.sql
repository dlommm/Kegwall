ALTER TABLE taps ADD COLUMN cleaning_ignored INTEGER NOT NULL DEFAULT 0 CHECK (cleaning_ignored IN (0, 1));
