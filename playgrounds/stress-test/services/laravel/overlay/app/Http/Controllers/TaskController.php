<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Http\RedirectResponse;
use Illuminate\View\View;

class TaskController extends Controller
{
    public function create(): View
    {
        return view('tasks.create');
    }

    public function store(Request $request): RedirectResponse
    {
        $data = $request->validate([
            'title'       => ['required', 'string', 'min:3', 'max:80'],
            'description' => ['required', 'string', 'min:10'],
            'priority'    => ['required', 'in:low,normal,high'],
        ]);

        // Stress-lab demo: we don't persist; flash the submitted payload so the
        // rendered Blade page on the next GET can confirm round-trip.
        return redirect()
            ->route('home')
            ->with('status', 'Task accepted: '.$data['title']);
    }
}
