-- Face sign-in (Plan B): per-drinker face descriptors, computed CLIENT-side on the
-- tablet (no image ever reaches the server). Multiple rows per drinker improve
-- matching (angles/lighting); db/faceEmbeddings.ts caps them at 5, oldest-out.
CREATE TABLE face_embeddings (
  id INTEGER PRIMARY KEY,
  drinker_id INTEGER NOT NULL REFERENCES users(id),
  embedding TEXT NOT NULL,           -- JSON array of floats (~1024 dims from human's faceres)
  created_at TEXT NOT NULL
);
CREATE INDEX idx_face_embeddings_drinker ON face_embeddings(drinker_id);
