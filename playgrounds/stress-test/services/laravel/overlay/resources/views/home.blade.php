@extends('layouts.app')

@section('title', 'Blade Legacy Lab')

@section('content')
    <section class="panel">
        <h2>What this stresses</h2>
        <ul>
            <li>Server-rendered Blade templates with annotask attribute injection in PHP output</li>
            <li>Full-page reloads and form POST validation round-trips</li>
            <li>Source mapping tasks back to <code>resources/views/*.blade.php</code></li>
            <li>Mixed JSON + HTML responses from the same Laravel origin</li>
        </ul>
    </section>

    <section class="panel">
        <h2>Workflow queue</h2>
        <table>
            <thead>
                <tr><th>ID</th><th>Title</th><th>Status</th></tr>
            </thead>
            <tbody>
                @foreach ($workflows as $wf)
                    <tr>
                        <td><code>{{ $wf['id'] }}</code></td>
                        <td>{{ $wf['title'] }}</td>
                        <td><span class="pill {{ $wf['status'] }}">{{ $wf['status'] }}</span></td>
                    </tr>
                @endforeach
            </tbody>
        </table>
    </section>

    <section class="panel">
        <h2>Actions</h2>
        <a class="btn btn-primary" href="{{ route('tasks.create') }}">New task</a>
        <a class="btn" href="/api/health">Probe /api/health</a>
    </section>
@endsection
