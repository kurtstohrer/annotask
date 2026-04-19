@extends('layouts.app')

@section('title', 'New task')

@section('content')
    <section class="panel">
        <h2>Create task</h2>

        <form method="POST" action="{{ route('tasks.store') }}">
            @csrf

            <label>
                Title
                <input type="text" name="title" value="{{ old('title') }}" />
            </label>
            @error('title') <div class="err">{{ $message }}</div> @enderror

            <label>
                Description
                <textarea name="description" rows="4">{{ old('description') }}</textarea>
            </label>
            @error('description') <div class="err">{{ $message }}</div> @enderror

            <label>
                Priority
                <select name="priority">
                    <option value="low"    @selected(old('priority') === 'low')>Low</option>
                    <option value="normal" @selected(old('priority', 'normal') === 'normal')>Normal</option>
                    <option value="high"   @selected(old('priority') === 'high')>High</option>
                </select>
            </label>
            @error('priority') <div class="err">{{ $message }}</div> @enderror

            <div style="margin-top: 16px;">
                <button type="submit" class="btn btn-primary">Submit</button>
                <a href="{{ route('home') }}" class="btn">Cancel</a>
            </div>
        </form>
    </section>
@endsection
