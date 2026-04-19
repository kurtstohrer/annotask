@extends('layouts.app')

@section('title', 'Blade Legacy Lab')

@section('content')
    <x-card title="What this stresses">
        <ul>
            <li>Server-rendered Blade templates with annotask attribute injection in PHP output</li>
            <li>Native Blade <code>&lt;x-*&gt;</code> component library discovery</li>
            <li>Full-page reloads and form POST validation round-trips</li>
            <li>Source mapping tasks back to <code>resources/views/*.blade.php</code></li>
        </ul>
    </x-card>

    <x-card title="Workflow queue">
        <x-workflow-table :workflows="$workflows" />
    </x-card>

    <x-card title="Actions">
        <x-button variant="primary" :href="route('tasks.create')">New task</x-button>
        <x-button :href="'/api/health'">Probe /api/health</x-button>
    </x-card>
@endsection
