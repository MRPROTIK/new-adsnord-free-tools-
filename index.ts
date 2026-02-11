export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.includes("/keyword-analyzer")) {
      const keyword = url.searchParams.get("keyword") || "";
      const goal = url.searchParams.get("goal") || "";
      const business = url.searchParams.get("business") || "";

      const analysis = {
        status: "Success",
        results: {
          short_tail: `${keyword} ${business}`,
          long_tail: `how to ${goal} with ${keyword}`,
          suggestion: "Target this for your adsnord landing page."
        }
      };

      return new Response(JSON.stringify(analysis), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    return new Response("Adsnord Hub is Ready. Use /keyword-analyzer");
  }
};
