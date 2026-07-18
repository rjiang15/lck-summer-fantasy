-- CreateTable
CREATE TABLE "LeagueBackup" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "originalLeagueId" INTEGER NOT NULL,
    "originalLeagueName" TEXT NOT NULL,
    "originalLeagueSlug" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "snapshotVersion" INTEGER NOT NULL,
    "snapshotJson" TEXT NOT NULL,
    "ownerUserId" INTEGER NOT NULL,
    "createdByUserId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceDeletedAt" DATETIME,
    "restoredAt" DATETIME,
    "restoredLeagueId" INTEGER,
    CONSTRAINT "LeagueBackup_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeagueBackup_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "LeagueBackup_ownerUserId_createdAt_idx" ON "LeagueBackup"("ownerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "LeagueBackup_originalLeagueId_createdAt_idx" ON "LeagueBackup"("originalLeagueId", "createdAt");
