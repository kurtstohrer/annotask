<!doctype html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Stress Lab — Blade Legacy Lab</title>
    <style>
        body { margin: 0; font-family: system-ui, sans-serif; color: #1a202c; }
        main { padding: 28px 32px; max-width: 780px; line-height: 1.55; }
        h1 { margin: 0 0 4px; font-size: 22px; }
        .sub { color: #64748b; margin: 0 0 24px; font-size: 13px; }
        .panel { border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px 20px; margin-bottom: 16px; background: #fff; }
        .panel h2 { margin: 0 0 10px; font-size: 15px; color: #334155; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #e2e8f0; }
        th { color: #64748b; font-weight: 500; }
        .pill { display: inline-block; padding: 1px 8px; border-radius: 999px; background: #eef2f7; color: #475569; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
        .pill.pending { background: #fff3cd; color: #92400e; }
        .pill.review { background: #dbeafe; color: #1d4ed8; }
        .pill.in_progress { background: #dcfce7; color: #166534; }
        .btn { display: inline-block; padding: 6px 14px; border-radius: 6px; border: 1px solid #cbd5e1; background: #f8fafc; cursor: pointer; font-size: 13px; text-decoration: none; color: inherit; }
        .btn-primary { background: #1d64e3; border-color: #1d64e3; color: #fff; }
        .flash { padding: 10px 14px; border-radius: 8px; background: #dcfce7; color: #166534; margin-bottom: 16px; font-size: 13px; }
        label { display: block; margin-top: 10px; font-size: 13px; color: #334155; }
        input[type="text"], textarea, select { width: 100%; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font: inherit; margin-top: 4px; }
        .err { color: #b91c1c; font-size: 12px; margin-top: 4px; }
        code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; background: #f1f5f9; padding: 1px 5px; border-radius: 4px; }
    </style>
</head>
<body>
    <main>
        <header>
            <h1>@yield('title', 'Blade Legacy Lab')</h1>
            <p class="sub">
                MFE id <code>blade-legacy-lab</code> · port 4350 · served by Laravel
            </p>
        </header>

        @if (session('status'))
            <div class="flash">{{ session('status') }}</div>
        @endif

        @yield('content')
    </main>
</body>
</html>
