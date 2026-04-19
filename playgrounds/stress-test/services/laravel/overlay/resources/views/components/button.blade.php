@props(['variant' => 'default', 'href' => null, 'type' => 'button'])

@php
    $classes = 'btn'.($variant === 'primary' ? ' btn-primary' : '');
@endphp

@if ($href)
    <a href="{{ $href }}" {{ $attributes->merge(['class' => $classes]) }}>{{ $slot }}</a>
@else
    <button type="{{ $type }}" {{ $attributes->merge(['class' => $classes]) }}>{{ $slot }}</button>
@endif
