const clerkDomain = process.env.CLERK_JWT_ISSUER_DOMAIN;

export default {
  providers: [
    {
      type: "customJwt",
      issuer: `https://${clerkDomain}`,
      // Clerk JWTs use RS256 and expose JWKS at /.well-known/jwks.json
      algorithm: "RS256",
      jwks: `https://${clerkDomain}/.well-known/jwks.json`,
      applicationID: process.env.CLERK_PUBLISHABLE_KEY,
    },
  ],
};
