export const onRequest: PagesFunction = async (context) => {
  // Pass the request through to the asset/page
  const response = await context.next();

  // Check if the request is coming to the .pages.dev staging domain
  const url = new URL(context.request.url);
  if (url.hostname.endsWith('.pages.dev')) {
    // Clone the response so we can modify its headers
    const newResponse = new Response(response.body, response);
    // Add the noindex header ONLY for the staging domain
    newResponse.headers.set('X-Robots-Tag', 'noindex');
    return newResponse;
  }

  // Otherwise, return the normal response for the .com domain
  return response;
};
