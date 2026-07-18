-- CreateTable
CREATE TABLE "LeagueBackup" (
    "id" SERIAL NOT NULL,
    "originalLeagueId" INTEGER NOT NULL,
    "originalLeagueName" TEXT NOT NULL,
    "originalLeagueSlug" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "snapshotVersion" INTEGER NOT NULL,
    "snapshotJson" TEXT NOT NULL,
    "ownerUserId" INTEGER NOT NULL,
    "createdByUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceDeletedAt" TIMESTAMP(3),
    "restoredAt" TIMESTAMP(3),
    "restoredLeagueId" INTEGER,

    CONSTRAINT "LeagueBackup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeagueBackup_ownerUserId_createdAt_idx" ON "LeagueBackup"("ownerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "LeagueBackup_originalLeagueId_createdAt_idx" ON "LeagueBackup"("originalLeagueId", "createdAt");

-- AddForeignKey
ALTER TABLE "LeagueBackup" ADD CONSTRAINT "LeagueBackup_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeagueBackup" ADD CONSTRAINT "LeagueBackup_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
