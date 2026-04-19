@props(['title' => null])

<section {{ $attributes->merge(['class' => 'panel']) }}>
    @isset($title)
        <h2>{{ $title }}</h2>
    @endisset

    {{ $slot }}
</section>
