# Companies House lookup (development)

New endpoint: `GET /api/company-lookup?number=SC123456`

Configure `COMPANIES_HOUSE_API_KEY` in Vercel project environment variables. Do not use a `NEXT_PUBLIC_` prefix, commit credentials, or expose raw upstream responses.

The endpoint validates company-number shape, retrieves the official company profile server-side, and returns selected public fields and official filing due dates. It does **not** determine legal compliance or store customer information.

## Verification checklist

1. Confirm `npm run build` passes in GitHub Actions.
2. Without a key, a valid company number should return HTTP 503.
3. With a key, a real company number should return a company profile and source label.
4. Invalid input should return HTTP 400; unknown companies should return HTTP 404.
5. Verify upstream rate limits and timeout handling.
6. Keep production deployment protected until authentication and data isolation are verified.

No company-specific regulatory assessments are implemented in this change. This is a foundation for a future consent-based onboarding experience.
