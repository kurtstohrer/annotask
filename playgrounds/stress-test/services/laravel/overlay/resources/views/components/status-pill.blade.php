@props(['status'])

<span {{ $attributes->merge(['class' => 'pill '.$status]) }}>{{ $status }}</span>
