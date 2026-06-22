// Vercel Edge Middleware for Basic Auth
// Protects the entire primaryvowels.com site

export const config = {
  matcher: '/:path*',
};

export default function middleware(request) {
  const authHeader = request.headers.get('authorization');

  if (authHeader) {
    // Parse Basic Auth
    const [scheme, encoded] = authHeader.split(' ');

    if (scheme === 'Basic') {
      try {
        // Use Buffer (available in Vercel Edge)
        const buffer = Buffer.from(encoded, 'base64');
        const decoded = buffer.toString();
        const [user, pass] = decoded.split(':');

        if (user === 'admin' && pass === 'nimda') {
          // Credentials are correct — allow the request
          return;
        }
      } catch (e) {
        // Invalid base64 or format — fall through to 401
      }
    }
  }

  // No valid credentials — require authentication
  return new Response('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="PrimaryVowels"',
      'Content-Type': 'text/plain',
    },
  });
}
