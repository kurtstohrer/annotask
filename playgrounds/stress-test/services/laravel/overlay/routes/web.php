<?php

use App\Http\Controllers\HomeController;
use App\Http\Controllers\HealthController;
use App\Http\Controllers\TaskController;
use Illuminate\Support\Facades\Route;

Route::get('/', [HomeController::class, 'index'])->name('home');
Route::get('/api/health', [HealthController::class, 'show']);

Route::get('/tasks/new', [TaskController::class, 'create'])->name('tasks.create');
Route::post('/tasks', [TaskController::class, 'store'])->name('tasks.store');
