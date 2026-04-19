<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;

class HealthController extends Controller
{
    public function show(): JsonResponse
    {
        return response()->json([
            'status'  => 'ok',
            'service' => 'laravel',
            'port'    => (int) env('PORT', 4350),
            'version' => '0.0.1',
        ])->header('Access-Control-Allow-Origin', '*');
    }
}
