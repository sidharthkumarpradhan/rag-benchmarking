import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// GitHub Issues tracker for StagAI repository

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { action = 'list', owner, repo, issue_number, title, body, labels, state = 'open' } = await req.json();

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('github');
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    };

    if (!owner || !repo) {
      return Response.json({ error: 'owner and repo are required' }, { status: 400 });
    }

    const base = `https://api.github.com/repos/${owner}/${repo}`;

    if (action === 'list') {
      const params = new URLSearchParams({ state, per_page: '50' });
      const res = await fetch(`${base}/issues?${params}`, { headers });
      if (!res.ok) return Response.json({ error: await res.text() }, { status: res.status });
      const issues = await res.json();
      return Response.json({ issues });
    }

    if (action === 'create') {
      if (!title) return Response.json({ error: 'title is required' }, { status: 400 });
      const res = await fetch(`${base}/issues`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ title, body, labels })
      });
      if (!res.ok) return Response.json({ error: await res.text() }, { status: res.status });
      return Response.json({ issue: await res.json() });
    }

    if (action === 'close') {
      if (!issue_number) return Response.json({ error: 'issue_number is required' }, { status: 400 });
      const res = await fetch(`${base}/issues/${issue_number}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ state: 'closed' })
      });
      if (!res.ok) return Response.json({ error: await res.text() }, { status: res.status });
      return Response.json({ issue: await res.json() });
    }

    if (action === 'stats') {
      const [openRes, closedRes] = await Promise.all([
        fetch(`${base}/issues?state=open&per_page=1`, { headers }),
        fetch(`${base}/issues?state=closed&per_page=1`, { headers })
      ]);
      const openCount = parseInt(openRes.headers.get('x-total-count') || '0') ||
        (await openRes.json()).length;
      const closedCount = parseInt(closedRes.headers.get('x-total-count') || '0') ||
        (await closedRes.json()).length;

      const repoRes = await fetch(base, { headers });
      const repoData = repoRes.ok ? await repoRes.json() : {};

      return Response.json({
        open_issues: repoData.open_issues_count || openCount,
        closed_issues: closedCount,
        stars: repoData.stargazers_count || 0,
        forks: repoData.forks_count || 0,
        description: repoData.description,
        html_url: repoData.html_url
      });
    }

    return Response.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});