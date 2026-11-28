"""Amatsukaze の作り物: 書く（POST / PUT / DELETE）"""

class _MockWriteMixin:
    """Amatsukaze の作り物: 書く（POST / PUT / DELETE）"""

    def _handle_post(self, path: str, payload, files):
        if path == "/api/system/end" or path == "/api/system/cancel-sleep":
            return True
        elif path == "/api/queue/add":
            new_id = self.next_queue_id
            self.next_queue_id += 1
            if payload and "targets" in payload and payload["targets"]:
                src = payload["targets"][0].get("path", "unknown")
            else:
                src = "batch_dir"
            outputs = payload.get("outputs") or [{}]
            profile = outputs[0].get("profile", "デフォルト") if outputs else "デフォルト"
            self.queue_items.append({
                "id": new_id,
                "state": "active",
                "srcPath": src,
                "priority": 3,
                "progress": 0,
                "profile": profile
            })
            return {"requestId": f"demo-req-{new_id}"}
        elif path == "/api/queue/change":
            item_id = payload.get("itemId")
            c_type = payload.get("changeType")
            if c_type == "RemoveItem":
                self.queue_items = [i for i in self.queue_items if i["id"] != item_id]
            elif c_type == "Priority":
                for i in self.queue_items:
                    if i["id"] == item_id: i["priority"] = payload.get("priority", 3)
            return True
        elif path == "/api/queue/move-many":
            return True
        elif path == "/api/queue/pause":
            pause = payload.get("pause", False)
            is_q = payload.get("isQueue", True)
            idx = payload.get("index", 0)
            if is_q:
                self.system_state["pause"] = pause
            else:
                if 0 <= idx < len(self.system_state["encoderSuspended"]):
                    self.system_state["encoderSuspended"][idx] = pause
            return True
        elif path == "/api/queue/cancel-add":
            return True
        elif path == "/api/profiles":
            self.profiles.append(payload)
            return True
        elif path == "/api/autoselect":
            self.auto_selects.append(payload)
            return True
        elif path == "/api/services/update":
            return True
        elif path == "/api/services/logo":
            return True
        elif path == "/api/services/logo/probe":
            return {"isExtended": False, "serviceId": 1024, "serviceName": "Dummy", "imageWidth": 1920, "imageHeight": 1080}
        elif path == "/api/services/logo/rescan":
            return True
        elif path.endswith("/logos/no-logo"):
            return True
        elif path == "/api/drcs":
            return True
        elif path == "/api/logo/analyze":
            return {"jobId": 999}
        elif path == "/api/trim/sessions":
            return {"sessionId": 1234}
        elif path.endswith("/save"):
            return True

        return {"demo_post_mock": True}

    def _handle_put(self, path: str, payload):
        if path.startswith("/api/profiles/"):
            name = path.split("/")[-1]
            for i, p in enumerate(self.profiles):
                if p["name"] == name:
                    self.profiles[i] = payload
            return True
        elif path.startswith("/api/autoselect/"):
            return True
        elif "/logos/period" in path or "/logos/enabled" in path:
            return True
        elif path == "/api/drcs/map":
            return True
        elif path == "/api/settings":
            self.settings.update(payload)
            return True

        return {"demo_put_mock": True}

    def _handle_delete(self, path: str, payload=None):
        if path.startswith("/api/profiles/"):
            name = path.split("/")[-1]
            self.profiles = [p for p in self.profiles if p["name"] != name]
            return True
        elif path.startswith("/api/autoselect/"):
            name = path.split("/")[-1]
            self.auto_selects = [a for a in self.auto_selects if a.get("name") != name]
            return True
        elif "/logos" in path:
            return True
        elif "/api/drcs/map/" in path:
            return True
        elif path.startswith("/api/trim/sessions/"):
            return True
        elif path.startswith("/api/trim/tempdir/"):
            return True
        
        return True
