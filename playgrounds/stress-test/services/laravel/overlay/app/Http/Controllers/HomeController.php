<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\View\View;

class HomeController extends Controller
{
    public function index(): View
    {
        $workflows = [
            ['id' => 'wf-1', 'title' => 'New lease request',  'status' => 'pending'],
            ['id' => 'wf-2', 'title' => 'Invoice adjustment', 'status' => 'review'],
            ['id' => 'wf-3', 'title' => 'Access revocation',  'status' => 'pending'],
            ['id' => 'wf-4', 'title' => 'Vendor onboarding',  'status' => 'in_progress'],
        ];

        return view('home', ['workflows' => $workflows]);
    }
}
