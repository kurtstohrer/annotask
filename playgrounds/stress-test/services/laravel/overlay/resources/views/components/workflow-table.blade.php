@props(['workflows'])

<table>
    <thead>
        <tr><th>ID</th><th>Title</th><th>Status</th></tr>
    </thead>
    <tbody>
        @foreach ($workflows as $wf)
            <tr>
                <td><code>{{ $wf['id'] }}</code></td>
                <td>{{ $wf['title'] }}</td>
                <td><x-status-pill :status="$wf['status']" /></td>
            </tr>
        @endforeach
    </tbody>
</table>
