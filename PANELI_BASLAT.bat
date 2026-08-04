@echo off
title Kronik Tarih Kanali Buyume Sistemi
cd /d C:\projeler\youtube
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 4; Start-Process 'http://localhost:3000'"
call npm.cmd run dev
