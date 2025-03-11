"use client";

import "./style.css";
import { InferenceEngine, CVImage, Prediction } from "inferencejs";
import { useEffect, useRef, useState, useMemo } from "react";
import { v4 as uuidv4 } from 'uuid';
import { db } from "../src/config/firebase";
import { collection, addDoc, Timestamp } from "firebase/firestore";

// Define interfaces
interface Transaction {
  uuid: string;
  tx_start_dt: string;
  cart_checkout: {
    red_tulip: number;
    yellow_tulip: number;
    blue_iris: number;
  };
}

interface PriceList {
  [key: string]: number;
}

function App() {
  const inferEngine = useMemo(() => {
    return new InferenceEngine();
  }, []);
  const [modelWorkerId, setModelWorkerId] = useState<string | null>(null);
  const [modelLoading, setModelLoading] = useState(false);

  // Cash register state
  const [transaction, setTransaction] = useState<Transaction>({
    uuid: uuidv4(),
    tx_start_dt: new Date().toISOString(),
    cart_checkout: {
      red_tulip: 0,
      yellow_tulip: 0,
      blue_iris: 0
    }
  });
  const [txTotal, setTxTotal] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [checkoutMessage, setCheckoutMessage] = useState<string>("");
  
  // Firebase connection status
  const [firebaseConnected, setFirebaseConnected] = useState<boolean | null>(null);
  
  // State for tracking stable objects
  const [stableObjects, setStableObjects] = useState<{[key: string]: any}>({});
  // Frame counter for timing
  const frameCounterRef = useRef<number>(0);
  // Object history tracking for LPF
  const objectHistoryRef = useRef<{[key: string]: any}>({});

  // Define price list
  const priceList: PriceList = {
    "red_tulip_1": 0.75,
    "yellow_tulip_1": 0.75,
    "blue_iris_1": 1.50
  };

  // Create refs for audio and middle line position
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  // Updated to store object with arm/scan/disarm states
  const previousPredictionsRef = useRef<{[key: string]: any}>({});
  const middleLineRef = useRef<number>(0);

  // Monitor device online status and network connectivity
  useEffect(() => {
    // Check initial connection
    setFirebaseConnected(navigator.onLine);
    
    // Set up event listeners for online/offline status
    const handleOnline = () => {
      console.log("[Firebase] 🟢 Device is online");
      setFirebaseConnected(true);
    };
    
    const handleOffline = () => {
      console.log("[Firebase] 🔴 Device is offline");
      setFirebaseConnected(false);
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    // Clean up event listeners
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Add a connection test when the component mounts
  useEffect(() => {
    const testFirebaseConnection = async () => {
      try {
        // Try to get the server timestamp (a lightweight operation)
        const timestamp = Timestamp.now();
        console.log(`[Firebase] ✅ Connection test successful, server timestamp: ${timestamp.toDate().toISOString()}`);
        setFirebaseConnected(true);
      } catch (error) {
        console.error("[Firebase] ❌ Connection test failed:", error);
        setFirebaseConnected(false);
      }
    };
    
    // Run the test
    testFirebaseConnection();
  }, []);

  useEffect(() => {
    if (!modelLoading) {
      setModelLoading(true);
      inferEngine
        .startWorker("floral-shop-visual-checkout", 2, "rf_urmfUoKJ7hZhz9bJiQ9xNEtAw883")
        .then((id) => setModelWorkerId(id));
    }
  }, [inferEngine, modelLoading]);

  useEffect(() => {
    console.log("Model Worker ID: " + modelWorkerId);
    if (modelWorkerId) {
      startWebcam();
    }
  }, [modelWorkerId]);

  const startWebcam = () => {
    var constraints = {
      audio: false,
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: "environment",
      },
    };

    navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = function () {
          if (videoRef.current) {
            videoRef.current.play();
          }
        };

        videoRef.current.onplay = () => {
          if (!canvasRef.current || !videoRef.current) return;
          
          var ctx = canvasRef.current.getContext("2d");
          if (!ctx) return;

          var height = videoRef.current.videoHeight;
          var width = videoRef.current.videoWidth;

          videoRef.current.width = width;
          videoRef.current.height = height;

          canvasRef.current.width = width;
          canvasRef.current.height = height;

          ctx.scale(1, 1);
          
          // Calculate middle line position
          middleLineRef.current = width / 2;
          console.log(`Video dimensions: ${width}x${height}, Middle line set at: ${middleLineRef.current}`);

          detectFrame();
        };
      }
    }).catch(error => {
      console.error("Error accessing webcam:", error);
    });
  };

  // Play cash register beep sound
  const playBeepSound = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(err => console.error("Error playing sound:", err));
    }
  };

  // Process item checkout
  const processItemCheckout = (itemClass: string) => {
    // Play beep sound
    playBeepSound();
    
    // Update cart and total based on item class
    let newTransaction = {...transaction};
    let price = 0;
    
    if (itemClass.includes("red_tulip")) {
      newTransaction.cart_checkout.red_tulip += 1;
      price = priceList["red_tulip_1"] || 0;
      console.log(`[Cart] Added red tulip: $${price}`);
    } else if (itemClass.includes("yellow_tulip")) {
      newTransaction.cart_checkout.yellow_tulip += 1;
      price = priceList["yellow_tulip_1"] || 0;
      console.log(`[Cart] Added yellow tulip: $${price}`);
    } else if (itemClass.includes("blue_iris")) {
      newTransaction.cart_checkout.blue_iris += 1;
      price = priceList["blue_iris_1"] || 0;
      console.log(`[Cart] Added blue iris: $${price}`);
    } else {
      console.log(`[Cart] Unknown item class: ${itemClass}, not adding to cart`);
    }
    
    // Update state
    setTransaction(newTransaction);
    setTxTotal(prevTotal => {
      const newTotal = prevTotal + price;
      console.log(`[Cart] Transaction total updated: $${newTotal.toFixed(2)}`);
      return newTotal;
    });
  };

  // Handle payment submission with enhanced Firebase diagnostics
  const handlePayment = async () => {
    try {
      setIsSubmitting(true);
      console.log("[Firebase] 📤 Attempting to write transaction to Firestore:", transaction);
      
      // Add connection status check
      if (!navigator.onLine) {
        console.error("[Firebase] ❌ Device appears to be offline. Cannot connect to Firebase.");
        setCheckoutMessage("Cannot connect to payment service. Please check your internet connection.");
        return;
      }
      
      // Record start time for performance measurement
      const startTime = performance.now();
      
      // Add transaction to Firestore with enhanced logging
      const docRef = await addDoc(collection(db, "transactions"), transaction);
      
      // Calculate operation duration
      const duration = Math.round(performance.now() - startTime);
      
      // Success logging
      console.log(`[Firebase] ✅ Transaction successfully written to Firestore in ${duration}ms`);
      console.log(`[Firebase] 📝 Document ID: ${docRef.id}`);
      console.log(`[Firebase] 📊 Transaction data:`, JSON.stringify(transaction, null, 2));
      
      // Reset transaction
      setTransaction({
        uuid: uuidv4(),
        tx_start_dt: new Date().toISOString(),
        cart_checkout: {
          red_tulip: 0,
          yellow_tulip: 0,
          blue_iris: 0
        }
      });
      setTxTotal(0);
      setCheckoutMessage("Payment successful!");
      
      // Clear message after 3 seconds
      setTimeout(() => setCheckoutMessage(""), 3000);
    } catch (error) {
      // Enhanced error logging
      console.error("[Firebase] ❌ Error submitting payment:", error);
      
      // Provide more specific error messages based on error types
      let errorMessage = "Payment failed. Please try again.";
      
      if (error instanceof Error) {
        console.error(`[Firebase] 🔍 Error name: ${error.name}, Message: ${error.message}`);
        
        if (error.message.includes("permission-denied")) {
          errorMessage = "Payment authorization failed. Please try again.";
        } else if (error.message.includes("unavailable")) {
          errorMessage = "Payment service is currently unavailable. Please try again later.";
        } else if (error.message.includes("network")) {
          errorMessage = "Network error occurred. Please check your internet connection.";
        }
      }
      
      setCheckoutMessage(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Apply low-pass filter and track stable objects
  const trackStableObjects = (predictions: Prediction[]) => {
    // Low-pass filter configuration
    const alpha = 0.3; // Filter weight (lower = more smoothing)
    const minDetections = 3; // Minimum number of detections before considering an object stable
    const maxMissingFrames = 15; // Maximum number of frames an object can be missing before removing it
    const confidenceThreshold = 0.4; // Minimum confidence to consider a detection valid
    
    // Current frame objects by class - used to track which objects are seen this frame
    const currentFrameObjects: {[key: string]: boolean} = {};
    
    // Process current predictions
    predictions.forEach(prediction => {
      // Skip low confidence detections
      if (prediction.confidence < confidenceThreshold) return;
      
      // Create a class-based ID (focus on flower type, not exact position)
      const classId = prediction.class;
      
      // Mark as seen this frame
      currentFrameObjects[classId] = true;
      
      // Initialize or update object history
      if (!objectHistoryRef.current[classId]) {
        objectHistoryRef.current[classId] = {
          class: prediction.class,
          detectionCount: 1,
          missingFrames: 0,
          lastSeen: frameCounterRef.current,
          positions: [{
            x: prediction.bbox.x,
            y: prediction.bbox.y,
            width: prediction.bbox.width,
            height: prediction.bbox.height
          }],
          filteredPosition: {
            x: prediction.bbox.x,
            y: prediction.bbox.y, 
            width: prediction.bbox.width,
            height: prediction.bbox.height
          },
          previousX: prediction.bbox.x,
          movingLeft: false,
          checkoutState: {
            armed: false,
            scanned: false,
            disarmed: false,
            cleanupCounter: 0
          }
        };
      } else {
        const objHistory = objectHistoryRef.current[classId];
        
        // Update detection stats
        objHistory.detectionCount += 1;
        objHistory.missingFrames = 0;
        objHistory.lastSeen = frameCounterRef.current;
        
        // Calculate if moving left (lower X value means moving left)
        const currentX = prediction.bbox.x;
        
        // Determine direction with some hysteresis to prevent rapid changes
        // Only change direction if moved at least 3 pixels in the new direction
        if (currentX < objHistory.previousX - 3) {
          objHistory.movingLeft = true;
        } else if (currentX > objHistory.previousX + 3) {
          objHistory.movingLeft = false;
        }
        
        // Store current position for next comparison
        objHistory.previousX = currentX;
        
        // Store raw position
        objHistory.positions.push({
          x: prediction.bbox.x,
          y: prediction.bbox.y,
          width: prediction.bbox.width,
          height: prediction.bbox.height
        });
        
        // Limit position history
        if (objHistory.positions.length > 10) {
          objHistory.positions.shift();
        }
        
        // Apply low-pass filter to position
        objHistory.filteredPosition = {
          x: objHistory.filteredPosition.x * (1 - alpha) + prediction.bbox.x * alpha,
          y: objHistory.filteredPosition.y * (1 - alpha) + prediction.bbox.y * alpha,
          width: objHistory.filteredPosition.width * (1 - alpha) + prediction.bbox.width * alpha,
          height: objHistory.filteredPosition.height * (1 - alpha) + prediction.bbox.height * alpha
        };
      }
    });
    
    // Update missing frames count for objects not seen in this frame
    Object.keys(objectHistoryRef.current).forEach(id => {
      if (!currentFrameObjects[id]) {
        objectHistoryRef.current[id].missingFrames += 1;
      }
    });
    
    // Remove objects that haven't been seen for too long
    Object.keys(objectHistoryRef.current).forEach(id => {
      if (objectHistoryRef.current[id].missingFrames > maxMissingFrames) {
        console.log(`🗑️ Removing unstable object ${id} - missing for ${objectHistoryRef.current[id].missingFrames} frames`);
        delete objectHistoryRef.current[id];
      }
    });
    
    // Create a map of stable objects
    const newStableObjects: {[key: string]: any} = {};
    
    Object.keys(objectHistoryRef.current).forEach(id => {
      const obj = objectHistoryRef.current[id];
      
      // Only include objects that have been detected enough times
      if (obj.detectionCount >= minDetections) {
        newStableObjects[id] = {
          class: obj.class,
          bbox: {
            x: obj.filteredPosition.x,
            y: obj.filteredPosition.y,
            width: obj.filteredPosition.width,
            height: obj.filteredPosition.height
          },
          missingFrames: obj.missingFrames,
          detectionCount: obj.detectionCount,
          movingLeft: obj.movingLeft,
          checkoutState: obj.checkoutState
        };
      }
    });
    
    return newStableObjects;
  };

  // Check if stable object should trigger checkout - with reduced logging
  const checkStableObjectsForCheckout = (stableObj: any, prediction: Prediction, frameWidth: number) => {
    const itemId = stableObj.class;
    const middleX = middleLineRef.current;
    
    // Define arm, scan, and disarm regions
    const armRegion = middleX + (frameWidth * 0.15); // 15% to the right of middle
    const disarmRegion = middleX - (frameWidth * 0.15); // 15% to the left of middle
    
    // Get center X position
    const centerX = prediction.bbox.x;
    
    // Get current checkout state
    const checkoutState = stableObj.checkoutState;
    
    if (!checkoutState) return false;
    
    // Step 1: Arm the scanner when the object is between arm line and middle line and moving left
    if (!checkoutState.armed && centerX < armRegion && centerX > middleX && stableObj.movingLeft) {
      checkoutState.armed = true;
      // Removed arming log
    }
    
    // Step 2: Scan the item when it crosses the middle line (only if armed and moving left)
    if (checkoutState.armed && !checkoutState.scanned && centerX <= middleX && stableObj.movingLeft) {
      checkoutState.scanned = true;
      // Kept only this important log
      console.log(`🔴 SCANNED: ${itemId}`);
      // Process the item
      processItemCheckout(prediction.class);
      return true;
    }
    
    // Step 3: Disarm the scanner when object fully passes the disarm line
    if (checkoutState.scanned && !checkoutState.disarmed && centerX < disarmRegion) {
      checkoutState.disarmed = true;
      // Removed disarming log
    }
    
    // Clean up disarmed objects after a delay
    const cleanupInterval = 60; // frames (approximately 2 seconds at 30fps)
    
    if (checkoutState.disarmed) {
      checkoutState.cleanupCounter++;
    }
    
    // Reset state if object moves back to the right of the arm line
    if ((checkoutState.armed || checkoutState.scanned || checkoutState.disarmed) && centerX > armRegion) {
      // Removed reset log
      checkoutState.armed = false;
      checkoutState.scanned = false;
      checkoutState.disarmed = false;
      checkoutState.cleanupCounter = 0;
    }
    
    return checkoutState.scanned && !checkoutState.disarmed;
  };

  // Legacy function - keeping for reference but no longer being used directly
  const checkItemCrossedMiddle = (prediction: Prediction, frameWidth: number) => {
    // Now handled by checkStableObjectsForCheckout
    return false;
  };

  const detectFrame = () => {
    if (!modelWorkerId || !videoRef.current || !canvasRef.current) {
      setTimeout(detectFrame, 100 / 3);
      return;
    }

    const img = new CVImage(videoRef.current);
    inferEngine.infer(modelWorkerId, img).then((predictions: Prediction[]) => {
      if (!canvasRef.current) return;
      
      const ctx = canvasRef.current.getContext("2d");
      if (!ctx) return;
      
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      frameCounterRef.current++;
      
      // Apply LPF and get stable objects
      const stableObjects = trackStableObjects(predictions);
      
      // Reduce frame info logging
      if (frameCounterRef.current % 30 === 0) { // Only log every 30 frames (about once per second)
        console.log(`Frame: ${frameCounterRef.current}, Stable objects: ${Object.keys(stableObjects).length}`);
      }
      
      // Define regions
      const armRegion = middleLineRef.current + (canvasRef.current.width * 0.15);
      const disarmRegion = middleLineRef.current - (canvasRef.current.width * 0.15);
      
      // Draw arm region line (green)
      ctx.beginPath();
      ctx.moveTo(armRegion, 0);
      ctx.lineTo(armRegion, canvasRef.current.height);
      ctx.strokeStyle = "rgba(0, 255, 0, 0.5)";
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // Draw middle line (red)
      ctx.beginPath();
      ctx.moveTo(middleLineRef.current, 0);
      ctx.lineTo(middleLineRef.current, canvasRef.current.height);
      ctx.strokeStyle = "rgba(255, 0, 0, 0.7)";
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // Draw disarm region line (blue)
      ctx.beginPath();
      ctx.moveTo(disarmRegion, 0);
      ctx.lineTo(disarmRegion, canvasRef.current.height);
      ctx.strokeStyle = "rgba(0, 0, 255, 0.5)";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw debug text for region positions
      ctx.font = "16px monospace";
      ctx.fillStyle = "white";
      ctx.fillText(`Arm: ${armRegion.toFixed(0)}`, armRegion - 50, 20);
      ctx.fillText(`Middle: ${middleLineRef.current.toFixed(0)}`, middleLineRef.current - 50, 20);
      ctx.fillText(`Disarm: ${disarmRegion.toFixed(0)}`, disarmRegion - 50, 20);

      // First, draw raw detections with light opacity
      for (var i = 0; i < predictions.length; i++) {
        var prediction = predictions[i];
        
        // Draw raw detections with light opacity
        var x = prediction.bbox.x - prediction.bbox.width / 2;
        var y = prediction.bbox.y - prediction.bbox.height / 2;
        var width = prediction.bbox.width;
        var height = prediction.bbox.height;

        ctx.beginPath();
        ctx.rect(x, y, width, height);
        ctx.strokeStyle = `rgba(${parseInt(prediction.color.slice(1, 3), 16)}, ${parseInt(prediction.color.slice(3, 5), 16)}, ${parseInt(prediction.color.slice(5, 7), 16)}, 0.3)`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      
      // Then draw stable objects and process them
      Object.keys(stableObjects).forEach(objId => {
        const stableObj = stableObjects[objId];
        
        // Create a stable prediction object to match the original format
        const stablePrediction = {
          class: stableObj.class,
          bbox: stableObj.bbox,
          color: "#00FF00", // Green for stable objects
          confidence: 1.0 // We've already filtered by confidence
        };
        
        // Fix: Add non-null assertion to satisfy TypeScript
        checkStableObjectsForCheckout(stableObj, stablePrediction, canvasRef.current!.width);    
        
        // Draw stable object bounding box
        var x = stableObj.bbox.x - stableObj.bbox.width / 2;
        var y = stableObj.bbox.y - stableObj.bbox.height / 2;
        var width = stableObj.bbox.width;
        var height = stableObj.bbox.height;

        // Color based on checkout state
        let boxColor = "#00FF00"; // Default green
        if (stableObj.checkoutState) {
          if (stableObj.checkoutState.scanned && !stableObj.checkoutState.disarmed) {
            boxColor = "#FF0000"; // Red when being scanned
          } else if (stableObj.checkoutState.armed && !stableObj.checkoutState.scanned) {
            boxColor = "#FFA500"; // Orange when armed
          } else if (stableObj.checkoutState.disarmed) {
            boxColor = "#0000FF"; // Blue when disarmed
          }
        }

        ctx.beginPath();
        ctx.rect(x, y, width, height);
        ctx.strokeStyle = boxColor;
        ctx.lineWidth = 3;
        ctx.stroke();
        
        // Draw stable object label
        ctx.fillStyle = boxColor;
        ctx.fillRect(x - 2, y - 30, 150, 30);
        ctx.font = "15px monospace";
        ctx.fillStyle = "black";
        ctx.fillText(
          `${stableObj.class}`,
          x,
          y - 10
        );
        
        // Get tracking state
        const stateText = stableObj.checkoutState ? 
          `A:${stableObj.checkoutState.armed ? 1 : 0} S:${stableObj.checkoutState.scanned ? 1 : 0} D:${stableObj.checkoutState.disarmed ? 1 : 0}` : 
          'New';
        
        // Draw state debug text
        ctx.fillStyle = "#FFFF00";
        ctx.fillRect(x - 2, y - 60, 120, 30);
        ctx.fillStyle = "black";
        ctx.fillText(stateText, x, y - 40);
        
        // Draw movement indicator
        if (stableObj.movingLeft) {
          ctx.fillStyle = "#FF00FF";
          ctx.fillText("⬅️ LEFT", x - 2, y - 70);
        } else {
          ctx.fillStyle = "#00FFFF"; 
          ctx.fillText("RIGHT ➡️", x - 2, y - 70);
        }
      });

      setTimeout(detectFrame, 100 / 3);
    }).catch(err => {
      console.error("Inference error:", err);
      setTimeout(detectFrame, 100 / 3);
    });
  };

  return (
    <div>
      <div style={{ position: "relative" }}>
        <video
          id="video"
          width="640"
          height="480"
          ref={videoRef}
          style={{ position: "relative" }}
        />
        <canvas
          id="canvas"
          width="640"
          height="480"
          ref={canvasRef}
          style={{ position: "absolute", top: 0, left: 0 }}
        />
        {/* Hidden audio element for beep sound */}
        <audio ref={audioRef} src="/cash-register-sound.mp3" style={{ display: "none" }} />
      </div>
      
      {/* Checkout Information */}
      <div style={{ marginTop: "20px", padding: "20px", backgroundColor: "#f5f5f5", borderRadius: "10px" }}>
        <h2>Flower Shop Checkout</h2>
        
        <div style={{ marginTop: "10px" }}>
          <h3>Cart Items:</h3>
          <ul>
            <li>Red Tulips: {transaction.cart_checkout.red_tulip} × $0.75 = ${(transaction.cart_checkout.red_tulip * 0.75).toFixed(2)}</li>
            <li>Yellow Tulips: {transaction.cart_checkout.yellow_tulip} × $0.75 = ${(transaction.cart_checkout.yellow_tulip * 0.75).toFixed(2)}</li>
            <li>Blue Iris: {transaction.cart_checkout.blue_iris} × $1.50 = ${(transaction.cart_checkout.blue_iris * 1.50).toFixed(2)}</li>
          </ul>
        </div>
        
        <div style={{ marginTop: "20px", display: "flex", gap: "15px" }}>
          <button 
            className="hero_button_secondary"
            style={{ backgroundColor: "#4CAF50" }}
          >
            Total: ${txTotal.toFixed(2)}
          </button>
          
          <button 
            className="hero_button_secondary"
            onClick={handlePayment}
            disabled={isSubmitting || txTotal <= 0}
          >
            {isSubmitting ? "Processing..." : "Pay Now"}
          </button>
        </div>
        
        {checkoutMessage && (
          <div style={{ 
            marginTop: "10px", 
            padding: "10px", 
            backgroundColor: checkoutMessage.includes("successful") ? "#DFF2BF" : "#FFBABA",
            color: checkoutMessage.includes("successful") ? "#4F8A10" : "#D8000C",
            borderRadius: "5px" 
          }}>
            {checkoutMessage}
          </div>
        )}
      </div>
      
      {/* Firebase Connection Status Indicator */}
      <div 
        style={{ 
          position: 'fixed', 
          top: '10px', 
          right: '10px',
          padding: '5px 10px',
          borderRadius: '4px',
          backgroundColor: firebaseConnected === null 
            ? '#888' 
            : firebaseConnected 
              ? '#4CAF50' 
              : '#F44336',
          color: 'white',
          fontSize: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
        }}
      >
        {firebaseConnected === null 
          ? '⏳ Connecting...' 
          : firebaseConnected 
            ? '🟢 Connected' 
            : '🔴 Disconnected'}
      </div>
    </div>
  );
}

export default App;