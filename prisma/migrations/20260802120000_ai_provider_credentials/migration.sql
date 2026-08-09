CREATE TABLE "AiProviderCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "apiKeyCiphertext" TEXT NOT NULL,
    "apiKeyFingerprint" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProviderCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiProviderCredential_userId_key" ON "AiProviderCredential"("userId");

ALTER TABLE "AiProviderCredential" ADD CONSTRAINT "AiProviderCredential_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
