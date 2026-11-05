#!/data/data/com.termux/files/usr/bin/bash
# Run by Termux:Boot after the device reboots. Do not call directly.
termux-wake-lock
sleep 15
bash "$HOME/brain/daemon.sh"
